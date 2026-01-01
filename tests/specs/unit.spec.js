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
        expect(Eval.evaluate("value.constructor", {}, () => {}, () => {})).toBe(false); 
        expect(Eval.evaluate("value.__proto__", {}, () => {}, () => {})).toBe(false);
    });

    it('SECURITY: should fail on dangerous code execution', () => {
        // The parser expects specific operators, random JS shouldn't execute
        // This is a smoke test for the parser structure
        expect(Eval.evaluate("alert(1)", '', () => {}, () => {})).toBe(false);
        expect(Eval.evaluate("window.location = 'bad'", '', () => {}, () => {})).toBe(false);
    });

    it('should handle operator precedence (AND > OR)', () => {
            // false && true || true
            // If AND > OR: (false && true) || true -> false || true -> true
            // If OR > AND: false && (true || true) -> false && true -> false
            expect(Eval.evaluate('false && true || true', null, () => {}, () => {})).toBe(true);

            // true || false && false
            // If AND > OR: true || (false && false) -> true || false -> true
            // If OR > AND: (true || false) && false -> true && false -> false
            expect(Eval.evaluate('true || false && false', null, () => {}, () => {})).toBe(true);
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