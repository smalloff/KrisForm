/**
 * Unit Tests for KrisForm Logic
 */

describe('Validator Engine', () => {
    const validator = new KrisFormValidator();

    it('should validate required fields', () => {
        const el = document.createElement('input');
        
        expect(validator.validate('', 'required', el).valid).toBe(false);
        expect(validator.validate(null, 'required', el).valid).toBe(false);
        expect(validator.validate('hello', 'required', el).valid).toBe(true);
    });

    it('should validate email formats', () => {
        const el = document.createElement('input');
        
        expect(validator.validate('test@example.com', 'email', el).valid).toBe(true);
        expect(validator.validate('invalid-email', 'email', el).valid).toBe(false);
        expect(validator.validate('test@domain', 'email', el).valid).toBe(false);
    });

    it('should validate numeric ranges (min/max)', () => {
        const elNumber = document.createElement('input');
        elNumber.type = 'number';

        // Numeric checks
        expect(validator.validate(10, 'min:5', elNumber).valid).toBe(true);
        expect(validator.validate(4, 'min:5', elNumber).valid).toBe(false);
        
        const elText = document.createElement('input');
        elText.type = 'text';

        // String length checks
        expect(validator.validate('hello', 'min:3', elText).valid).toBe(true);
        expect(validator.validate('hi', 'min:3', elText).valid).toBe(false);
    });

    it('should validate character complexity (min_lower/upper)', () => {
        const el = document.createElement('input');

        // Lowercase check
        expect(validator.validate('ABC', 'min_lower:1', el).valid).toBe(false);
        expect(validator.validate('ABCd', 'min_lower:1', el).valid).toBe(true);
        expect(validator.validate('abc', 'min_lower:2', el).valid).toBe(true);
    });

    it('should handle multiple rules', () => {
        const el = document.createElement('input');
        // required AND min:3
        expect(validator.validate('', 'required,min:3', el).valid).toBe(false); // fails required
        expect(validator.validate('ab', 'required,min:3', el).valid).toBe(false); // fails min
        expect(validator.validate('abc', 'required,min:3', el).valid).toBe(true);
    });
    
    it('should validate complex rules (credit card)', () => {
         const el = document.createElement('input');
         // Luhn algorithm check
         expect(validator.validate('4242424242424242', 'credit_card', el).valid).toBe(true); // Valid test card
         expect(validator.validate('4242424242424241', 'credit_card', el).valid).toBe(false); // Invalid
    });
});

describe('Evaluator (Security & Logic)', () => {
    // Evaluator was exposed via our patch
    const Eval = window.KrisFormEvaluator;

    it('should evaluate simple conditions', () => {
        const ctx = { value: 10 };
        expect(Eval.evaluate('value > 5', 10, () => {}, () => {})).toBe(true);
        expect(Eval.evaluate('value === 10', 10, () => {}, () => {})).toBe(true);
        expect(Eval.evaluate('value < 5', 10, () => {}, () => {})).toBe(false);
    });

    it('should evaluate complex boolean logic', () => {
        const ctx = { value: 'admin' };
        // (true || false) -> true
        expect(Eval.evaluate("value === 'admin' || value === 'manager'", 'admin', () => {}, () => {})).toBe(true);
        // (false && true) -> false
        expect(Eval.evaluate("value === 'user' && value === 'admin'", 'admin', () => {}, () => {})).toBe(false);
    });

    it('should allow whitelisted string methods', () => {
        const ctx = { value: 'foobar' };
        expect(Eval.evaluate("value.includes('bar')", 'foobar', () => {}, () => {})).toBe(true);
        expect(Eval.evaluate("value.startsWith('foo')", 'foobar', () => {}, () => {})).toBe(true);
    });

    it('SECURITY: should prevent prototype pollution access', () => {
        const ctx = { value: {} };
        // Trying to access constructor
        // Evaluator returns null for invalid/blocked access
        expect(Eval.evaluate("value.constructor", {}, () => {}, () => {})).toBe(null); 
        expect(Eval.evaluate("value.__proto__", {}, () => {}, () => {})).toBe(null);
    });

    it('SECURITY: should fail on dangerous code execution', () => {
        // The parser expects specific operators, random JS shouldn't execute
        expect(Eval.evaluate("alert(1)", '', () => {}, () => {})).toBe(null);
        expect(Eval.evaluate("window.location = 'bad'", '', () => {}, () => {})).toBe(null);
    });

    it('should handle operator precedence (AND > OR)', () => {
            // false && true || true
            expect(Eval.evaluate('false && true || true', null, () => {}, () => {})).toBe(true);
            // true || false && false
            expect(Eval.evaluate('true || false && false', null, () => {}, () => {})).toBe(true);
        });

    it('should evaluate arithmetic expressions (+, -, *, / and precedence)', () => {
        // Simple Addition
        expect(Eval.evaluate('10 + 20', null, () => {}, () => {})).toBe(30);
        expect(Eval.evaluate('25 - 10 - 3', null, () => {}, () => {})).toBe(12);
        expect(Eval.evaluate('6 * 7', null, () => {}, () => {})).toBe(42);
        expect(Eval.evaluate('20 / 4', null, () => {}, () => {})).toBe(5);
        expect(Eval.evaluate('10 + 5 * 2', null, () => {}, () => {})).toBe(20);
        expect(Eval.evaluate('(10 + 5) * 2', null, () => {}, () => {})).toBe(30);
        expect(Eval.evaluate('10 / 0', null, () => {}, () => {})).toBe(0);
        
        // With Context Resolution (simulated via internal method)
        // Evaluator.evaluate() wraps context in {value: ...}, so we use _evaluateRecursive directly for testing custom context
        const ctx = { a: 5, b: 10 };
        expect(Eval._evaluateRecursive('a + b + 5', ctx, () => {})).toBe(20);
        expect(Eval._evaluateRecursive('b * a - 15', ctx, () => {})).toBe(35);
    });

    it('should evaluate unary logical NOT (!)', () => {
        expect(Eval.evaluate('!false', null, () => false, () => {})).toBe(true);
        expect(Eval.evaluate('!checked', null, (s) => s === 'checked' ? false : null, () => {})).toBe(true);
    });

    it('should evaluate math functions (max/min)', () => {
        expect(Eval.evaluate('max(10, 20, 5)', null, () => {}, () => {})).toBe(20);
        expect(Eval.evaluate('min(10, 20, 5)', null, () => {}, () => {})).toBe(5);
        
        // Nested logic inside functions
        expect(Eval.evaluate('max(10, 5 + 25)', null, () => {}, () => {})).toBe(30);
    });
});

describe('Validator Advanced Patterns', () => {
    const validator = new KrisFormValidator();
    const el = document.createElement('input');

    it('should validate Network addresses', () => {
        // IPv4
        expect(validator.validate('192.168.1.1', 'ip', el).valid).toBe(true);
        expect(validator.validate('256.256.256.256', 'ip', el).valid).toBe(false);
        
        // URL
        expect(validator.validate('https://google.com', 'url', el).valid).toBe(true);
        expect(validator.validate('javascript:alert(1)', 'url', el).valid).toBe(false);
    });

    it('should validate DateTime', () => {
        expect(validator.validate('2023-10-10', 'datetime', el).valid).toBe(true);
        expect(validator.validate('invalid-date', 'datetime', el).valid).toBe(false);
        
        // Custom Format (YYYY-MM-DD)
        expect(validator.validate('2023-12-31', 'datetime:2006-01-02', el).valid).toBe(true);
        expect(validator.validate('31-12-2023', 'datetime:2006-01-02', el).valid).toBe(false);
    });

    it('should validate Strings content', () => {
        expect(validator.validate('Hello World', 'alpha', el).valid).toBe(false); // space not allowed
        expect(validator.validate('HelloWorld', 'alpha', el).valid).toBe(true);
        
        expect(validator.validate('A123', 'alphanum', el).valid).toBe(true);
        
        expect(validator.validate('#ff0000', 'hexcolor', el).valid).toBe(true);
        expect(validator.validate('red', 'hexcolor', el).valid).toBe(false);
    });
});

describe('Utils (Nested Divs & Composite Controls)', () => {
    const Utils = window.KrisFormUtils;

    it('should resolve named textarea inside nested div wrapper', () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-field-name', 'body');
        wrapper.innerHTML = `
            <div class="toolbar"><input type="color" value="#2563eb"><input type="file"></div>
            <div class="content">
                <div contenteditable="true"><p>Visual text</p></div>
                <textarea name="body">Markdown text content</textarea>
            </div>
        `;

        const resolved = Utils.resolveControl(wrapper);
        expect(resolved.tagName).toBe('TEXTAREA');
        expect(Utils.getFieldValue([wrapper])).toBe('Markdown text content');
    });

    it('should extract textContent from contenteditable or plain nested divs when no form control exists', () => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<div><span>Nested div text</span></div>';
        expect(Utils.getFieldValue([wrapper])).toBe('Nested div text');

        Utils.setElementValue(wrapper, 'Updated text');
        expect(Utils.getFieldValue([wrapper])).toBe('Updated text');
    });

    it('should support select[multiple] getFieldValue and setElementValue', () => {
        const select = document.createElement('select');
        select.multiple = true;
        select.innerHTML = '<option value="a">A</option><option value="b">B</option><option value="c">C</option>';

        Utils.setElementValue(select, ['a', 'c']);
        expect(Utils.getFieldValue([select])).toEqual(['a', 'c']);
    });

    it('should support comma-separated oneof rules alongside chained rules', () => {
        const validator = new KrisFormValidator();
        const el = document.createElement('input');

        expect(validator.validate('green', 'required,oneof:red,green,blue', el).valid).toBe(true);
        expect(validator.validate('yellow', 'required,oneof:red,green,blue', el).valid).toBe(false);
    });

    it('SECURITY: should sanitize HTML messages and block dangerous URLs', () => {
        const dirty = '<b>Safe</b><script>alert(1)</script><a href="javascript:evil()" onclick="steal()">Link</a>';
        const clean = Utils.sanitizeHTML(dirty);
        expect(clean.includes('<script')).toBe(false);
        expect(clean.includes('javascript:')).toBe(false);
        expect(clean.includes('onclick')).toBe(false);
        expect(clean.includes('<b>Safe</b>')).toBe(true);

        expect(Utils.isSafeUrl('javascript:alert(1)')).toBe(false);
        expect(Utils.isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
        expect(Utils.isSafeUrl('/api/check?v=1')).toBe(true);
    });
});