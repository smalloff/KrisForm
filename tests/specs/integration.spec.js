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
    function createForm(html) {
        if (container) document.body.removeChild(container);
        container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        form = container.querySelector('form');
        return new KrisForm(form, { updateDelay: 0 }); // 0 delay for instant tests
    }

    it('should show error on invalid input', async () => {
        const kris = createForm(`
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
});