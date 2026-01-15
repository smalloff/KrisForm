/**
 * Integration Tests (DOM, Events, Dependencies)
 */

describe('KrisForm Integration', () => {
    let form, container;

    // Setup global messages for consistent testing
    window.KrisFormTranslateMessages = {
        required: "This field is required",
        email: "Invalid email"
    };

    // Setup helper
    function createForm(html, options = {}) {
        if (container) document.body.removeChild(container);
        container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        form = container.querySelector('form');
        return new KrisForm(form, { updateDelay: 0, ...options }); // 0 delay for instant tests
    }

    it('should show error on invalid input', async () => {
        const kris = createForm(`
            <form>
                <div class="input-group">
                    <input name="username" data-validator="required">
                    <div class="invalid-feedback"></div>
                </div>
            </form>
        `, { validationMode: 'immediate' }); // Explicitly set immediate mode
            <form>
                <div class="input-group">
                    <input name="username" data-validator="required">
                    <div class="invalid-feedback"></div>
                </div>
            </form>
        `);

        const input = form.querySelector('[name="username"]');
        const feedback = form.querySelector('.invalid-feedback');

        // Trigger validation
        input.value = '';
        // CRITICAL: bubbles: true is required for delegation listener on form
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        await wait(50); // wait for debounce

        expect(input.classList.contains('is-invalid')).toBe(true);
        expect(feedback.style.display).toBe('block');
        expect(feedback.textContent).toBe('This field is required'); // Default English message
    });

    it('should clear error on valid input', async () => {
        const kris = createForm(`
            <form>
                <div class="input-group">
                    <input name="username" data-validator="required">
                    <div class="invalid-feedback"></div>
                </div>
            </form>
        `);

        const input = form.querySelector('[name="username"]');
        
        // Make invalid first
        input.value = '';
        kris.validateField(input);
        expect(input.classList.contains('is-invalid')).toBe(true);

        // Make valid
        input.value = 'John';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        await wait(50);

        expect(input.classList.contains('is-invalid')).toBe(false);
    });

    it('should handle dependencies (Show/Hide)', async () => {
        const html = `
            <form>
                <select name="role">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
                <div class="field-container" id="admin_panel" style="display:none">
                    <input name="secret_key">
                </div>
            </form>
        `;
        
        createForm(html); // Just create DOM
        
        // Init with logic
        const kris = new KrisForm(form, {
            updateDelay: 0,
            dependencies: [
                {
                    source: 'role',
                    condition: "value === 'admin'",
                    action: 'show',
                    inverse_action: 'hide',
                    target: 'secret_key' // targets field, library finds container
                }
            ]
        });

        const select = form.querySelector('[name="role"]');
        const targetContainer = document.getElementById('admin_panel');

        // Initial state
        expect(targetContainer.style.display).toBe('none');

        // Change to admin
        select.value = 'admin';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        
        await wait(50);
        
        // Should be visible (KrisForm removes display:none style or sets empty)
        expect(targetContainer.style.display).toBe(''); 

        // Change back to user
        select.value = 'user';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        
        await wait(50);
        
        expect(targetContainer.style.display).toBe('none');
    });

    it('should block submit if form is invalid', () => {
        createForm(`
            <form>
                <input name="req" data-validator="required">
                <button type="submit">Go</button>
            </form>
        `);
        
        let submitted = false;
        form.addEventListener('submit', (e) => {
            submitted = true;
            // Native preventDefault happens in library, we just check if it propagated or stopped
        });

        const btn = form.querySelector('button');
        btn.click(); // This triggers submit event

        // Since KrisForm listens to submit and does e.preventDefault() if invalid
        // We verify via the library state or class
        const input = form.querySelector('[name="req"]');
        expect(input.classList.contains('is-invalid')).toBe(true);
    });

    it('should handle Radio Groups and Enable/Disable actions', async () => {
        const html = `
            <form>
                <input type="radio" name="plan" value="free" checked> Free
                <input type="radio" name="plan" value="pro"> Pro
                
                <input name="credit_card" disabled>
            </form>
        `;
        
        createForm(html);
        
        const kris = new KrisForm(form, {
            updateDelay: 0,
            dependencies: [
                {
                    source: 'plan',
                    condition: "value === 'pro'",
                    action: 'enable',
                    inverse_action: 'disable',
                    target: 'credit_card'
                }
            ]
        });

        const radioPro = form.querySelector('input[value="pro"]');
        const radioFree = form.querySelector('input[value="free"]');
        const cardInput = form.querySelector('[name="credit_card"]');

        // Initially disabled (because plan is free)
        // Wait for init calculation
        await wait(20);
        expect(cardInput.disabled).toBe(true);

        // Switch to Pro
        radioPro.checked = true;
        // Radio changes trigger on change event, bubbling needed
        radioPro.dispatchEvent(new Event('change', { bubbles: true }));
        
        await wait(50);
        expect(cardInput.disabled).toBe(false);

        // Switch back to Free
        radioFree.checked = true;
        radioFree.dispatchEvent(new Event('change', { bubbles: true }));
        
        await wait(50);
        expect(cardInput.disabled).toBe(true);
    });

    it('should handle Cross-Field Validation logic', () => {
        // Test validator logic directly to isolate from DOM query issues in test env
        const validator = new KrisFormValidator();
        const formEl = document.createElement('form');
        document.body.appendChild(formEl); // Mount to DOM to ensure .form prop works reliable
        
        const otherEl = document.createElement('input');
        otherEl.name = 'other';
        otherEl.value = 'data';
        formEl.appendChild(otherEl);
        
        const targetEl = document.createElement('input');
        targetEl.name = 'target';
        targetEl.value = ''; // empty
        formEl.appendChild(targetEl);

        try {
            // Rule: required_with:other
            // Since other is 'data' (present), target should be required.
            // Target is empty -> should be INVALID.
            const result = validator.validate('', 'required_with:other', targetEl);
            expect(result.valid).toBe(false);
            expect(result.failed).toBe('required_with');
        } finally {
            document.body.removeChild(formEl);
        }
    });

    it('should avoid duplicate requests (race condition protection)', async () => {
        const originalFetch = window.fetch;
        let callCount = 0;
        
        // Mock fetch with a slight delay to simulate network latency
        window.fetch = (url) => {
            callCount++;
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve({
                        ok: true,
                        json: () => Promise.resolve({ value: 'loaded' })
                    });
                }, 50); // 50ms network delay
            });
        };

        try {
            const html = `
                <form>
                    <input name="trigger">
                    <input name="target">
                </form>
            `;
            createForm(html);
            const kris = new KrisForm(form, {
                updateDelay: 0,
                dependencies: [{
                    source: 'trigger',
                    condition: "value.length > 0",
                    action: 'set_value',
                    'data-url': '/api/data', // data-url trigger
                    target: 'target'
                }]
            });

            const input = form.querySelector('[name="trigger"]');
            input.value = 'a';
            
            // Trigger input (starts fetch 1)
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Trigger change immediately (simulating fast user action or browser behavior)
            // Without fix, this starts fetch 2 because fetch 1 hasn't resolved yet
            input.dispatchEvent(new Event('change', { bubbles: true }));

            // Wait for fetches to resolve
            await wait(100);

            expect(callCount).toBe(1);

        } finally {
            window.fetch = originalFetch;
        }
    });

    it('should support Delayed validation mode', async () => {
        const kris = createForm(`
            <form>
                <input name="delayed" data-validator="min:3">
            </form>
        `, { validationMode: 'delayed', validationDelay: 100 });

        const input = form.querySelector('[name="delayed"]');
        
        // Input 'a' (invalid)
        input.value = 'a';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Should not be invalid yet
        expect(input.classList.contains('is-invalid')).toBe(false);
        
        // Wait > 100ms
        await wait(150);
        
        // Now should be invalid
        expect(input.classList.contains('is-invalid')).toBe(true);
    });

    it('should support Blur validation mode', async () => {
        const kris = createForm(`
            <form>
                <input name="blur_test" data-validator="required">
            </form>
        `, { validationMode: 'blur' });

        const input = form.querySelector('[name="blur_test"]');
        
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Should ignore input event
        expect(input.classList.contains('is-invalid')).toBe(false);
        
        // Trigger blur
        input.dispatchEvent(new Event('focusout', { bubbles: true }));
        
        expect(input.classList.contains('is-invalid')).toBe(true);
    });

    it('should support Lazy validation mode (Blur then Input)', async () => {
        const kris = createForm(`
            <form>
                <input name="lazy_test" data-validator="min:3">
            </form>
        `, { validationMode: 'lazy' });

        const input = form.querySelector('[name="lazy_test"]');
        
        // 1. First input (invalid) -> No error (Lazy)
        input.value = 'a';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(input.classList.contains('is-invalid')).toBe(false);
        
        // 2. Blur -> Error appears
        input.dispatchEvent(new Event('focusout', { bubbles: true }));
        expect(input.classList.contains('is-invalid')).toBe(true);
        
        // 3. Input again (valid) -> Error clears IMMEDIATELY (because field is dirty/invalid)
        input.value = 'abc';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(input.classList.contains('is-invalid')).toBe(false);
    });

    it('should handle Async Remote validation', async () => {
        const originalFetch = window.fetch;
        let fetchUrl = '';
        
        // Mock fetch
        window.fetch = (url) => {
            fetchUrl = url;
            return new Promise(resolve => {
                setTimeout(() => {
                    // Simulate server logic: "admin" is taken (invalid)
                    const isTaken = url.includes('admin');
                    resolve({
                        ok: true,
                        json: () => Promise.resolve({ 
                            valid: !isTaken, 
                            message: isTaken ? 'Username taken' : '' 
                        })
                    });
                }, 50);
            });
        };

        try {
            // Use immediate mode to trigger logic fast, but remote check has fixed 500ms debounce inside library
            const kris = createForm(`
                <form>
                    <input name="username" data-validator="required,remote:check_user">
                    <div class="invalid-feedback"></div>
                </form>
            `, { validationMode: 'immediate' });

            const input = form.querySelector('[name="username"]');
            const feedback = form.querySelector('.invalid-feedback');

            // 1. Enter taken username
            input.value = 'admin';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Should be valid sync (required passed), but waiting for async debounce (500ms)
            // Wait for debounce + fetch
            await wait(600);
            
            expect(fetchUrl).toContain('check_user');
            expect(input.classList.contains('is-invalid')).toBe(true);
            expect(feedback.textContent).toBe('Username taken');

            // 2. Enter valid username
            input.value = 'user1';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            await wait(600);
            
            expect(input.classList.contains('is-invalid')).toBe(false);

        } finally {
            window.fetch = originalFetch;
        }
    });
});