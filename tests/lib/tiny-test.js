/**
 * TinyTest - A zero-dependency test runner for Browser.
 * Mimics Jest/Mocha syntax.
 */
(function(global) {
    const results = [];
    let currentSuite = 'Root';

    const outputStyles = {
        pass: 'color: #10b981; font-weight: bold;',
        fail: 'color: #ef4444; font-weight: bold;',
        suite: 'color: #3b82f6; font-weight: bold; margin-top: 10px; display: block;',
        info: 'color: #6b7280;'
    };

    function renderUI() {
        const container = document.getElementById('test-results');
        if (!container) return;

        let passed = 0;
        let failed = 0;
        let html = '';

        results.forEach(r => {
            if (r.type === 'suite') {
                html += `<div class="suite-header">${r.name}</div>`;
            } else {
                if (r.passed) passed++; else failed++;
                const statusClass = r.passed ? 'status-pass' : 'status-fail';
                const icon = r.passed ? '✓' : '✕';
                html += `
                    <div class="test-row ${statusClass}">
                        <span class="icon">${icon}</span>
                        <span class="name">${r.name}</span>
                        ${r.error ? `<div class="error-msg">${r.error}</div>` : ''}
                    </div>
                `;
            }
        });

        const summaryClass = failed === 0 ? 'summary-pass' : 'summary-fail';
        container.innerHTML = `
            <div class="summary ${summaryClass}">
                Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}
            </div>
            ${html}
        `;
    }

    // --- Assertions ---

    class Expectation {
        constructor(value) {
            this.value = value;
        }

        toBe(expected) {
            if (this.value !== expected) {
                throw new Error(`Expected '${expected}', but got '${this.value}' (${typeof this.value})`);
            }
        }

        toEqual(expected) {
            const valStr = JSON.stringify(this.value);
            const expStr = JSON.stringify(expected);
            if (valStr !== expStr) {
                throw new Error(`Expected ${expStr}, but got ${valStr}`);
            }
        }

        toBeTruthy() {
            if (!this.value) throw new Error(`Expected value to be truthy`);
        }

        toBeFalsy() {
            if (this.value) throw new Error(`Expected value to be falsy`);
        }
        
        toContain(item) {
             if (Array.isArray(this.value) && !this.value.includes(item)) {
                  throw new Error(`Expected array to contain ${item}`);
             } else if (typeof this.value === 'string' && !this.value.includes(item)) {
                  throw new Error(`Expected string to contain '${item}'`);
             }
        }
    }

    // --- API ---

    global.describe = (name, fn) => {
        currentSuite = name;
        results.push({ type: 'suite', name });
        console.group(`%c${name}`, outputStyles.suite);
        try {
            fn();
        } catch (e) {
            console.error(e);
        }
        console.groupEnd();
    };

    global.it = async (name, fn) => {
        try {
            await fn();
            results.push({ type: 'test', passed: true, name, suite: currentSuite });
            console.log(`%c✓ ${name}`, outputStyles.pass);
        } catch (e) {
            results.push({ type: 'test', passed: false, name, suite: currentSuite, error: e.message });
            console.error(`%c✕ ${name}`, outputStyles.fail, e.message);
        }
        renderUI();
    };

    global.expect = (value) => new Expectation(value);
    
    // Helper to delay tests (for debounce logic)
    global.wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

})(window);