/**
 * KrisForm - Universal Form Library
 * Version: 2.3.0
 * Author: smalloff
 * Description: Secure, high-performance vanilla JS library for form validation, dependency management, and state handling.
 */

(function(global) {
    'use strict';

    // --- Constants & Configuration ---
    
    const CONSTANTS = {
        EVENT_NAMESPACE: 'krisform',
        ATTR: {
            PREFIX: 'data-',
            VALIDATOR: 'data-validator',
            FIELD: 'data-field',
            CONTAINER: 'data-field-container'
        }
    };

    const DEFAULTS = {
        updateDelay: 10, // ms, debouncing time
        endpoint: "", // Base URL for data-url requests
        selectors: {
            // Priority: data-attribute -> id-pattern -> class
            fieldContainers: ["[data-field-container]", "[id^='container_']", ".field-container"],
            fields: ["[name]", "[data-field]", 'input:not([type="hidden"])', "select", "textarea"],
            feedback: '.invalid-feedback',
            statusMessage: '.field-status-message',
            statusText: '.status-text',
            innerWrapper: '.field-inner-wrapper'
        },
        classes: {
            disabled: ["text-muted", "opacity-50", "pe-none"],
            required: ["required-field"],
            hidden: ["d-none"],
            invalid: ["is-invalid"],
            valid: ["is-valid"]
        },
        validationMode: 'lazy', // Options: 'immediate', 'delayed', 'blur', 'lazy'
        validationDelay: 300, // Debounce delay in ms
        i18n: {
            defaultError: "Validation failed"
        }
    };

    // --- Utils ---

    const Utils = {
        /**
         * Resolves the underlying value-holding element when a container/wrapper (e.g. div) is passed
         * @param {HTMLElement} el
         * @returns {HTMLElement}
         */
        resolveControl(el) {
            if (!el || !el.tagName) return el;
            const tag = el.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return el;
            if (!el.querySelector) return el;

            const fieldName = el.getAttribute('data-field-name') || el.getAttribute(CONSTANTS.ATTR.FIELD) || el.getAttribute('name');
            if (fieldName) {
                const named = el.querySelector(`[name="${CSS.escape(fieldName)}"]`);
                if (named) return named;
            }

            const control = el.querySelector('textarea[name], select[name], input[name]:not([type="hidden"]), input[type="hidden"][name], textarea, select');
            if (control) return control;

            const editable = el.querySelector('[contenteditable="true"]');
            if (editable) return editable;

            return el;
        },

        /**
         * Resolves the visible element to receive error classes and feedback when the control itself is hidden
         * @param {HTMLElement} el
         * @param {Object} [config]
         * @returns {HTMLElement}
         */
        resolveVisualElement(el, config) {
            if (!el) return el;
            if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return el;
            if (!el.closest) return el;

            const innerSel = (config && config.selectors && config.selectors.innerWrapper) || DEFAULTS.selectors.innerWrapper;
            const innerWrap = el.closest(innerSel);
            if (innerWrap && innerWrap.firstElementChild && innerWrap.firstElementChild !== el) {
                const candidate = innerWrap.firstElementChild;
                if (candidate.offsetWidth || candidate.offsetHeight || candidate.getClientRects().length) {
                    return candidate;
                }
            }

            if (el.parentElement && el.parentElement !== el.form) {
                const parent = el.parentElement;
                if (parent.offsetWidth || parent.offsetHeight || parent.getClientRects().length) {
                    return parent;
                }
            }
            return el;
        },

        /**
         * Safe check for element visibility
         * @param {HTMLElement} el 
         * @returns {boolean}
         */
        isVisible(el) {
            if (!el) return false;
            if (el.offsetWidth || el.offsetHeight || el.getClientRects().length) return true;
            if (!el.closest) return false;

            const scope = el.closest(DEFAULTS.selectors.innerWrapper) || el.parentElement;
            if (scope && scope !== el.form && scope !== document.body) {
                const editable = scope.querySelector('[contenteditable="true"]');
                if (editable && (editable.offsetWidth || editable.offsetHeight || editable.getClientRects().length)) {
                    return true;
                }
            }
            return false;
        },

        /**
         * Debounce function for performance
         */
        debounce(func, wait) {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), wait);
            };
        },

        /**
         * Safely sets text content to prevent XSS
         * @param {HTMLElement} el 
         * @param {string} text 
         */
        setText(el, text) {
            if (el) el.textContent = text;
        },

        /**
         * Sanitizes HTML string for status messages by stripping dangerous tags, event handlers, and script URIs
         * @param {string} html
         * @returns {string}
         */
        sanitizeHTML(html) {
            if (!html || typeof html !== 'string') return '';
            if (typeof DOMParser === 'undefined') {
                return html.replace(/<[^>]*>?/gm, '');
            }
            const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
            const dangerousTags = doc.body.querySelectorAll('script, iframe, object, embed, style, link, meta, base, form, input, button, textarea, svg, math');
            dangerousTags.forEach(node => node.remove());

            const all = doc.body.querySelectorAll('*');
            all.forEach(el => {
                for (let i = el.attributes.length - 1; i >= 0; i--) {
                    const attr = el.attributes[i];
                    const name = attr.name.toLowerCase();
                    const val = attr.value.trim().toLowerCase();
                    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
                        el.removeAttribute(attr.name);
                    } else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') && /^(javascript|vbscript|data):/i.test(val)) {
                        el.removeAttribute(attr.name);
                    }
                }
            });
            return doc.body.innerHTML;
        },

        /**
         * Validates that a URL is safe for fetch requests (prevents javascript:/data:/vbscript: schemes)
         * @param {string} url
         * @returns {boolean}
         */
        isSafeUrl(url) {
            if (!url || typeof url !== 'string') return false;
            const trimmed = url.trim();
            if (!trimmed || /^(javascript|vbscript|data):/i.test(trimmed)) return false;
            return true;
        },

        /**
         * Get unique elements from selector array
         */
        findFieldElements(root, name) {
            if (!root) return [];
            // Optimization: utilize querySelectorAll with composed selector if possible, 
            // but name attribute requires quoting.
            const selectors = [`[name="${CSS.escape(name)}"]`, `#${CSS.escape(name)}`, `[data-field="${CSS.escape(name)}"]`];
            const elements = [];
            selectors.forEach(sel => {
                const nodes = root.querySelectorAll(sel);
                for (let i = 0; i < nodes.length; i++) elements.push(nodes[i]);
            });
            return [...new Set(elements)];
        },

        findFieldContainer(element, config) {
            const selector = config.selectors.fieldContainers.join(", ");
            return element.closest(selector);
        },

        getFieldValue(elements) {
            if (!elements || elements.length === 0) return null;
            
            // Optimization: Early exit for single standard input or container
            if (elements.length === 1) {
                const el = this.resolveControl(elements[0]);
                if (el.type === 'checkbox') return el.checked;
                if (el.type === 'radio') return el.checked ? el.value : null;
                if (el.tagName === 'SELECT' && el.multiple) {
                    return Array.from(el.selectedOptions, opt => opt.value);
                }
                if (el.value !== undefined) return el.value;
                if (el.hasAttribute && el.hasAttribute('data-value')) return el.getAttribute('data-value');
                return el.textContent || '';
            }

            // Group handling
            const checkboxes = [];
            const radios = [];
            let standard = null;

            for (const rawEl of elements) {
                const el = this.resolveControl(rawEl);
                if (el.type === 'checkbox') checkboxes.push(el);
                else if (el.type === 'radio') radios.push(el);
                else if (!standard && el.type !== 'hidden' && el.value !== undefined) standard = el; // Prefer visible
            }

            if (checkboxes.length > 0) {
                if (checkboxes.length > 1) return checkboxes.filter(e => e.checked).map(e => e.value);
                return checkboxes[0].checked;
            }

            if (radios.length > 0) {
                const checked = radios.find(e => e.checked);
                return checked ? checked.value : null;
            }

            // Fallback to first element if logic above didn't catch (e.g. only hidden inputs or div containers)
            const fallback = standard || this.resolveControl(elements[0]);
            if (fallback.tagName === 'SELECT' && fallback.multiple) {
                return Array.from(fallback.selectedOptions, opt => opt.value);
            }
            if (fallback.value !== undefined) return fallback.value;
            if (fallback.hasAttribute && fallback.hasAttribute('data-value')) return fallback.getAttribute('data-value');
            return fallback.textContent || '';
        },

        setElementValue(el, val) {
            const target = this.resolveControl(el);
            if (target.type === "checkbox") {
                target.checked = (val === true || val === "true" || val === 1 || val === "1");
            } else if (target.type === "radio") {
                // For radio, we rely on the group logic, but if individual element is targeted:
                if (target.name) {
                    const radios = document.getElementsByName(target.name);
                    for(let i=0; i < radios.length; i++) {
                        radios[i].checked = (radios[i].value === String(val));
                    }
                } else {
                     target.checked = (target.value === String(val));
                }
            } else if (target.tagName === "SELECT" && target.multiple) {
                const values = Array.isArray(val)
                    ? val.map(String)
                    : (val === null || val === undefined || val === '' ? [] : String(val).split(',').map(s => s.trim()));
                for (let i = 0; i < target.options.length; i++) {
                    target.options[i].selected = values.includes(target.options[i].value);
                }
            } else if (target.value !== undefined) {
                target.value = (val === null || val === undefined) ? '' : val;
            } else {
                target.textContent = (val === null || val === undefined) ? '' : String(val);
            }
        }
    };

    // --- Expression Evaluator (Hardened) ---

    class Evaluator {
        /**
         * Safe evaluation of expressions
         */
        static evaluate(expression, value, stateProvider, fieldProvider) {
            if (!expression || typeof expression !== 'string') return false;
            
            try {
                const context = {
                    value: value,
                    disabled: stateProvider("disabled"),
                    readonly: stateProvider("readonly"),
                    required: stateProvider("required"),
                    visible: stateProvider("visible"),
                    checked: stateProvider("checked")
                };
                return this._evaluateRecursive(expression.trim(), context, fieldProvider);
            } catch (e) {
                console.error("[KrisForm] Security/Parse Error in evaluator:", e);
                return false;
            }
        }

        static _evaluateRecursive(expr, context, fieldProvider) {
            // Remove outer parens safely
            while (expr.startsWith("(") && expr.endsWith(")")) {
                // Check if the outer parens are a matching pair covering the whole expression
                let depth = 0;
                let isPair = true;
                // Scan content excluding the very last char (which is known ')')
                for (let i = 0; i < expr.length - 1; i++) {
                    if (expr[i] === '(') depth++;
                    else if (expr[i] === ')') depth--;
                    
                    // If depth hits 0 before the end, the start/end parens are NOT a pair
                    // Example: "(a) && (b)" -> depth hits 0 after (a)
                    if (depth === 0) {
                        isPair = false;
                        break;
                    }
                }
                
                if (isPair) {
                    expr = expr.slice(1, -1).trim();
                } else {
                    break;
                }
            }
            let splitIdx = this._findSplitIndex(expr, "||");
            if (splitIdx !== -1) {
                return this._evaluateRecursive(expr.substring(0, splitIdx), context, fieldProvider) || 
                       this._evaluateRecursive(expr.substring(splitIdx + 2), context, fieldProvider);
            }

            // Logical AND
            splitIdx = this._findSplitIndex(expr, "&&");
            if (splitIdx !== -1) {
                return this._evaluateRecursive(expr.substring(0, splitIdx), context, fieldProvider) && 
                       this._evaluateRecursive(expr.substring(splitIdx + 2), context, fieldProvider);
            }

            return this._evaluateAtom(expr, context, fieldProvider);
        }

        static _findSplitIndex(text, sep) {
            let depth = 0;
            const sepLen = sep.length;
            for (let i = 0; i < text.length; i++) {
                if (text[i] === '(') depth++;
                else if (text[i] === ')') depth--;
                else if (depth === 0 && text.substring(i, i + sepLen) === sep) {
                    return i;
                }
            }
            return -1;
        }

        static _evaluateAtom(expr, context, fieldProvider) {
            expr = expr.trim();
            const operators = ["===", "!==", "==", "!=", ">=", "<=", ">", "<"];
            
            for (const op of operators) {
                const idx = this._findSplitIndex(expr, op);
                if (idx !== -1) {
                    const left = expr.substring(0, idx).trim();
                    const right = expr.substring(idx + op.length).trim();
                    return this._compare(
                        this._evaluateRecursive(left, context, fieldProvider), 
                        this._evaluateRecursive(right, context, fieldProvider), 
                        op
                    );
                }
            }

            // Unary logical NOT
            if (expr.startsWith("!")) {
                return !this._evaluateRecursive(expr.slice(1).trim(), context, fieldProvider);
            }

            // Method whitelist (Security)
            const ALLOWED_METHODS = ['includes', 'startsWith', 'endsWith'];
            for (const method of ALLOWED_METHODS) {
                const methodStr = `.${method}(`;
                if (expr.includes(methodStr)) {
                    return this._evalMethod(expr, context, method, fieldProvider);
                }
            }

            // Math Functions Support
            const mathMatch = expr.match(/^(?:Math\.)?(max|min|round|floor|ceil|abs)\(/);
            if (mathMatch && expr.endsWith(")")) return this._evalMathFunction(expr, mathMatch[1], context, fieldProvider);

            // Arithmetic Operations (Precedence-aware parser for + - * /)
            if (this._hasArithmeticOperator(expr)) {
                return this._evalArithmetic(expr, context, fieldProvider);
            }

            const val = this._resolve(expr, context, fieldProvider);
            return val;
        }

        static _hasArithmeticOperator(expr) {
            if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) return false;
            if (!isNaN(Number(expr)) && expr !== "") return false;
            let depth = 0;
            let inQuote = null;
            for (let i = 0; i < expr.length; i++) {
                const ch = expr[i];
                if (inQuote) {
                    if (ch === inQuote && expr[i - 1] !== '\\') inQuote = null;
                    continue;
                }
                if (ch === "'" || ch === '"') {
                    inQuote = ch;
                    continue;
                }
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (depth === 0 && (ch === '+' || ch === '*' || ch === '/' || (ch === '-' && i > 0))) {
                    return true;
                }
            }
            return false;
        }

        static _splitTopLevel(expr, ops) {
            const parts = [];
            let depth = 0;
            let inQuote = null;
            let lastIdx = 0;
            for (let i = 0; i < expr.length; i++) {
                const ch = expr[i];
                if (inQuote) {
                    if (ch === inQuote && expr[i - 1] !== '\\') inQuote = null;
                    continue;
                }
                if (ch === "'" || ch === '"') {
                    inQuote = ch;
                    continue;
                }
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (depth === 0 && ops.includes(ch)) {
                    // Ignore unary +/- at the start of a term or immediately after another operator
                    if ((ch === '+' || ch === '-') && expr.substring(lastIdx, i).trim() === '') {
                        continue;
                    }
                    parts.push({ term: expr.substring(lastIdx, i).trim(), op: ch });
                    lastIdx = i + 1;
                }
            }
            if (parts.length === 0) return null;
            parts.push({ term: expr.substring(lastIdx).trim(), op: null });
            return parts;
        }

        static _evalMathFunction(expr, func, context, fieldProvider) {
            // Extract arguments: max(a, b + c, d)
            const argsStr = expr.substring(expr.indexOf('(') + 1, expr.lastIndexOf(')'));
            const parts = [];
            let depth = 0;
            let lastIdx = 0;
            for (let i = 0; i < argsStr.length; i++) {
                if (argsStr[i] === '(') depth++;
                else if (argsStr[i] === ')') depth--;
                else if (depth === 0 && argsStr[i] === ',') {
                    parts.push(argsStr.substring(lastIdx, i).trim());
                    lastIdx = i + 1;
                }
            }
            parts.push(argsStr.substring(lastIdx).trim());

            const values = parts.filter(Boolean).map(p => {
                // Recursive eval for arguments (supports "fields.a + fields.b")
                return this._evaluateRecursive(p, context, fieldProvider);
            });

            const nums = values.map(v => Number(v) || 0);

            if (func === 'max') return Math.max(...nums);
            if (func === 'min') return Math.min(...nums);
            if (func === 'round') return Math.round(nums[0] || 0);
            if (func === 'floor') return Math.floor(nums[0] || 0);
            if (func === 'ceil') return Math.ceil(nums[0] || 0);
            if (func === 'abs') return Math.abs(nums[0] || 0);
            return 0;
        }

        static _evalArithmetic(expr, context, fieldProvider) {
            // 1. Addition & Subtraction (lowest precedence)
            const addParts = this._splitTopLevel(expr, ['+', '-']);
            if (addParts) {
                let acc = Number(this._evaluateRecursive(addParts[0].term, context, fieldProvider)) || 0;
                for (let i = 0; i < addParts.length - 1; i++) {
                    const op = addParts[i].op;
                    const nextVal = Number(this._evaluateRecursive(addParts[i + 1].term, context, fieldProvider)) || 0;
                    if (op === '+') acc += nextVal;
                    else if (op === '-') acc -= nextVal;
                }
                return acc;
            }

            // 2. Multiplication & Division (higher precedence)
            const mulParts = this._splitTopLevel(expr, ['*', '/']);
            if (mulParts) {
                let acc = Number(this._evaluateRecursive(mulParts[0].term, context, fieldProvider)) || 0;
                for (let i = 0; i < mulParts.length - 1; i++) {
                    const op = mulParts[i].op;
                    const nextVal = Number(this._evaluateRecursive(mulParts[i + 1].term, context, fieldProvider)) || 0;
                    if (op === '*') acc *= nextVal;
                    else if (op === '/') acc = nextVal === 0 ? 0 : acc / nextVal;
                }
                return acc;
            }

            return Number(this._resolve(expr, context, fieldProvider)) || 0;
        }

        static _evalMethod(expr, context, method, fieldProvider) {
            const parts = expr.split(`.${method}(`);
            if (parts.length < 2) return false;
            
            const targetExpr = parts[0].trim();
            const argExpr = parts[1].replace(/\)$/, "").trim();
            
            const targetVal = this._resolve(targetExpr, context, fieldProvider);
            const argVal = this._resolve(argExpr, context, fieldProvider);
            
            if (typeof targetVal === 'string' || Array.isArray(targetVal)) {
                return targetVal[method](argVal);
            }
            return false;
        }

        static _compare(left, right, op) {
            switch (op) {
                case "===": return left === right;
                case "!==": return left !== right;
                case "==": return left == right; // eslint-disable-line eqeqeq
                case "!=": return left != right; // eslint-disable-line eqeqeq
                case ">=": return Number(left) >= Number(right);
                case "<=": return Number(left) <= Number(right);
                case ">": return Number(left) > Number(right);
                case "<": return Number(left) < Number(right);
                default: return false;
            }
        }

        static _resolve(expr, context, fieldProvider) {
            expr = expr.trim();
            
            // Literals
            if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) return expr.slice(1, -1);
            if (!isNaN(Number(expr)) && expr !== "") return Number(expr);
            if (expr === "true") return true;
            if (expr === "false") return false;
            if (expr === "null") return null;
            if (expr === "undefined") return undefined;

            // Direct Context
            if (Object.prototype.hasOwnProperty.call(context, expr)) return context[expr];

            // Dynamic Fields
            if (expr.startsWith("fields.")) {
                return fieldProvider ? fieldProvider(expr.slice(7).trim()) : null;
            }
            if (expr.startsWith("source.")) {
                return context[expr.slice(7)];
            }
            
            // Nested Property Access (Protected from Prototype Pollution)
            if (expr.includes(".")) {
                const parts = expr.split(".");
                // Only allow access if root is in context
                if (Object.prototype.hasOwnProperty.call(context, parts[0])) {
                    let v = context[parts[0]];
                    for (let i = 1; i < parts.length; i++) {
                        const key = parts[i];
                        // SECURITY: Prevent accessing dangerous properties
                        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return null;
                        
                        if (v === null || v === undefined) return null;
                        v = v[key];
                    }
                    return v;
                }
            }
            return null;
        }
    }

    // --- Validator Engine ---

    class Validator {
        constructor() {
            // --- Regex Patterns (Precompiled) ---
            const RE_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            const RE_URL = /^(https?|ftp|file|git):\/\/[-a-zA-Z0-9+&@#/%?=~_|!:,.;]*[-a-zA-Z0-9+&@#/%=~_|]$/;
            const RE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:[a-zA-Z0-9%/?#:@&=+$,_.!~*'()]*$/;
            
            // --- Helpers ---
            
            // Luhn Algorithm for Credit Cards
            const luhnCheck = (val) => {
                let sum = 0, shouldDouble = false;
                val = String(val).replace(/\D/g, '');
                for (let i = val.length - 1; i >= 0; i--) {
                    let digit = parseInt(val.charAt(i));
                    if (shouldDouble) {
                        if ((digit *= 2) > 9) digit -= 9;
                    }
                    sum += digit;
                    shouldDouble = !shouldDouble;
                }
                return (sum % 10) === 0;
            };

            // Network Helpers
            const isIP = (str, version = 0) => {
                const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
                const ipv6 = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
                if (version === 4) return ipv4.test(str);
                if (version === 6) return ipv6.test(str);
                return ipv4.test(str) || ipv6.test(str);
            };

            const isCIDR = (str, version = 0) => {
                const parts = String(str).split('/');
                if (parts.length !== 2) return false;
                const ip = parts[0];
                const prefix = parseInt(parts[1], 10);
                if (isNaN(prefix)) return false;
                
                if (version === 4 || (version === 0 && isIP(ip, 4))) {
                    return isIP(ip, 4) && prefix >= 0 && prefix <= 32;
                }
                if (version === 6 || (version === 0 && isIP(ip, 6))) {
                    return isIP(ip, 6) && prefix >= 0 && prefix <= 128;
                }
                return false;
            };

            // Go-style Date Layout to Regex
            const parseGoDateLayout = (layout) => {
                const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                let pattern = escapeRegex(layout);
                const tokens = [
                    { k: '2006', v: '\\d{4}' }, { k: '06', v: '\\d{2}' },
                    { k: '01', v: '\\d{2}' },   { k: '02', v: '\\d{2}' },
                    { k: '15', v: '\\d{2}' },   { k: '03', v: '\\d{2}' },
                    { k: '04', v: '\\d{2}' },   { k: '05', v: '\\d{2}' },
                    { k: 'PM', v: '(?:AM|PM)' }, { k: 'MST', v: '[A-Z]{3}' },
                    { k: 'Z0700', v: '[+-]\\d{4}' }
                ];
                tokens.forEach(t => { pattern = pattern.replace(t.k, t.v); });
                return new RegExp(`^${pattern}$`);
            };

            // Cross-field value getter
            const getOtherVal = (el, name) => {
                if (!el.form) return null;
                const other = Utils.findFieldElements(el.form, name);
                return Utils.getFieldValue(other);
            };

            this.rules = {
                // --- Basic ---
                required: (val, _, el) => {
                    if (el && el.type === 'checkbox') return el.checked;
                    if (el && el.type === 'radio') return !!val;
                    if (Array.isArray(val)) return val.length > 0;
                    if (val === undefined || val === null) return false;
                    return String(val).trim().length > 0;
                },
                required_with: (val, p, el) => {
                    const otherVal = getOtherVal(el, p);
                    const hasOther = Array.isArray(otherVal) ? otherVal.length > 0 : (otherVal && String(otherVal).length > 0);
                    if (hasOther) return this.rules.required(val, null, el);
                    return true;
                },
                required_without: (val, p, el) => {
                    const otherVal = getOtherVal(el, p);
                    const hasOther = Array.isArray(otherVal) ? otherVal.length > 0 : (otherVal && String(otherVal).length > 0);
                    if (!hasOther) return this.rules.required(val, null, el);
                    return true;
                },
                
                // --- Comparison ---
                eq: (val, p) => String(val) === String(p),
                ne: (val, p) => String(val) !== String(p),
                lt: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) < Number(p) : (Array.isArray(val) ? val.length < Number(p) : Number(val) < Number(p)),
                gt: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) > Number(p) : (Array.isArray(val) ? val.length > Number(p) : Number(val) > Number(p)),
                lte: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) <= Number(p) : (Array.isArray(val) ? val.length <= Number(p) : Number(val) <= Number(p)),
                gte: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) >= Number(p) : (Array.isArray(val) ? val.length >= Number(p) : Number(val) >= Number(p)),
                
                // Cross-Field Comparisons
                eqfield: (val, p, el) => String(val) === String(getOtherVal(el, p)),
                nefield: (val, p, el) => String(val) !== String(getOtherVal(el, p)),
                gtfield: (val, p, el) => Number(val) > Number(getOtherVal(el, p)),
                gtefield: (val, p, el) => Number(val) >= Number(getOtherVal(el, p)),
                ltfield: (val, p, el) => Number(val) < Number(getOtherVal(el, p)),
                ltefield: (val, p, el) => Number(val) <= Number(getOtherVal(el, p)),
                
                // --- Numeric / Range / Length ---
                len: (val, p) => Array.isArray(val) ? val.length === Number(p) : String(val).length === Number(p),
                min: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) >= Number(p) : (Array.isArray(val) ? val.length >= Number(p) : String(val).length >= Number(p)),
                max: (val, p, el) => (el && (el.type === 'number' || el.type === 'range')) ? Number(val) <= Number(p) : (Array.isArray(val) ? val.length <= Number(p) : String(val).length <= Number(p)),

                // --- Complexity (Count Matches) ---
                min_alpha: (val, p) => (String(val).match(/[\p{L}]/gu) || []).length >= Number(p),
                min_lower: (val, p) => (String(val).match(/[\p{Ll}]/gu) || []).length >= Number(p),
                min_upper: (val, p) => (String(val).match(/[\p{Lu}]/gu) || []).length >= Number(p),
                min_digit: (val, p) => (String(val).match(/[0-9]/g) || []).length >= Number(p),
                min_symbol: (val, p) => (String(val).match(/[^\p{L}\p{N}\s]/gu) || []).length >= Number(p),

                // --- Strings & Formats ---
                alpha: (val) => /^[a-zA-Z]+$/.test(val),
                alphanum: (val) => /^[a-zA-Z0-9]+$/.test(val),
                alphaunicode: (val) => /^[\p{L}]+$/u.test(val),
                alphanumunicode: (val) => /^[\p{L}\p{N}]+$/u.test(val),
                numeric: (val) => /^\d+$/.test(val),
                number: (val) => !isNaN(Number(val)) && val !== '' && val !== null,
                hexadecimal: (val) => /^[0-9a-fA-F]+$/.test(val),
                
                lowercase: (val) => val === String(val).toLowerCase(),
                uppercase: (val) => val === String(val).toUpperCase(),
                ascii: (val) => /^[\x00-\x7F]+$/.test(val),
                print: (val) => /^[\x20-\x7E]+$/.test(val),
                multibyte: (val) => /[^\x00-\x7F]/.test(val),
                
                // --- Colors ---
                hexcolor: (val) => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val),
                rgb: (val) => /^rgb\(\s*(?:(?:\d{1,2}|1\d\d|2(?:[0-4]\d|5[0-5]))\s*,?){3}\)$/.test(val),
                rgba: (val) => /^rgba\(\s*(?:(?:\d{1,2}|1\d\d|2(?:[0-4]\d|5[0-5]))\s*,?){3}\s*(?:[0-9]*\.[0-9]+|[0-9]+)\)$/.test(val),
                hsl: (val) => /^hsl\(\s*(?:\d+|\d*\.\d+)\s*,\s*(?:\d+|\d*\.\d+)%\s*,\s*(?:\d+|\d*\.\d+)%\s*\)$/.test(val),
                hsla: (val) => /^hsla\(\s*(?:\d+|\d*\.\d+)\s*,\s*(?:\d+|\d*\.\d+)%\s*,\s*(?:\d+|\d*\.\d+)%\s*,\s*(?:[0-9]*\.[0-9]+|[0-9]+)\)$/.test(val),
                
                // --- Email & URL ---
                email: (val) => RE_EMAIL.test(val),
                email_list: (val) => val.split(',').every(e => RE_EMAIL.test(e.trim())),
                email_domain: (val, p) => String(val).toLowerCase().endsWith('@' + String(p).toLowerCase()),
                url: (val) => RE_URL.test(val),
                uri: (val) => RE_URI.test(val),
                
                urn_rfc2141: (val) => /^urn:[a-zA-Z0-9]{1,31}:([a-zA-Z0-9()+,-.:=@;$_!*']|%[0-9a-fA-F]{2})+$/.test(val),
                http_url: (val) => /^https?:\/\//.test(val) && this.rules.url(val),
                url_encoded: (val) => /^[^%]+$|^.*%[0-9a-fA-F]{2}.*$/.test(val),
                
                // --- Network & IP ---
                ip: (val) => isIP(val), // Defined separately in original but keeping unified logic here
                ipv4: (val) => isIP(val, 4),
                ipv6: (val) => isIP(val, 6),
                cidr: (val) => isCIDR(val),
                cidrv4: (val) => isCIDR(val, 4),
                cidrv6: (val) => isCIDR(val, 6),
                mac: (val) => /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(val),
                
                tcp_addr: (val) => {
                    const parts = val.split(':');
                    const port = parseInt(parts.pop(), 10);
                    const ip = parts.join(':');
                    return (isIP(ip) || this.rules.hostname(ip)) && port >= 0 && port <= 65535;
                },
                udp_addr: (val) => this.rules.tcp_addr(val),
                hostname: (val) => /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)+[a-zA-Z]{2,63}$/.test(val),
                hostname_rfc1123: (val) => /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)*[a-zA-Z0-9]{1,63}$/.test(val),
                fqdn: (val) => this.rules.hostname(val),

                // --- Phone ---
                e164: (val) => /^\+[1-9]\d{1,14}$/.test(val),
                phone: (val) => /^\+?(\d{1,3})?[-. (]*(\d{1,3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x(\d+))?$/.test(val),

                // --- Encodings & IDs ---
                base64: (val) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(val),
                base64url: (val) => /^[A-Za-z0-9-_]+$/.test(val),
                datauri: (val) => /^data:.+;base64,.+$/.test(val),
                magnet: (val) => /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,40}&dn=.+&tr=.+$/.test(val),
                
                isbn: (val) => /^(?:ISBN(?:-1[03])?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$|97[89][0-9]{10}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)(?:97[89][- ]?)?[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/.test(val),
                isbn10: (val) => /^(?:ISBN(?:-10)?:? )?(?=[0-9X]{10}$|(?=(?:[0-9]+[- ]){3})[- 0-9X]{13}$)[0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9X]$/.test(val),
                isbn13: (val) => /^(?:ISBN(?:-13)?:? )?(?=[0-9]{13}$|(?=(?:[0-9]+[- ]){4})[- 0-9]{17}$)97[89][0-9]{1,5}[- ]?[0-9]+[- ]?[0-9]+[- ]?[0-9]$/.test(val),
                issn: (val) => /^\d{4}-\d{3}[\dX]$/.test(val),
                
                uuid: (val) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val),
                uuid3: (val) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-3[0-9a-fA-F]{3}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val),
                uuid4: (val) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val),
                uuid5: (val) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-5[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val),
                
                // --- Geo & Misc ---
                latitude: (val) => /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/.test(val),
                longitude: (val) => /^[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/.test(val),
                ssn: (val) => /^\d{3}-\d{2}-\d{4}$/.test(val),
                
                semver: (val) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/.test(val),
                json: (val) => { try { JSON.parse(val); return true; } catch(e) { return false; } },
                jwt: (val) => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(val),
                
                // --- Financial ---
                bic: (val) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(val),
                credit_card: (val) => luhnCheck(val),
                btc_addr: (val) => /^(1|3)[a-zA-Z1-9]{26,33}$/.test(val),
                btc_addr_bech32: (val) => /^bc1[a-z0-9]{39,59}$/.test(val),
                eth_addr: (val) => /^0x[a-fA-F0-9]{40}$/.test(val),

                // --- Date & Time ---
                datetime: (val, param) => {
                    if (!param) return !isNaN(Date.parse(val));
                    return parseGoDateLayout(param).test(val);
                },
                timezone: (val) => {
                    try { Intl.DateTimeFormat(undefined, { timeZone: val }); return true; } 
                    catch (e) { return false; }
                },

                // --- Content & Logic ---
                contains: (val, p) => String(val).includes(p),
                containsany: (val, p) => [...String(p)].some(char => String(val).includes(char)),
                notcontains: (val, p) => !String(val).includes(p),
                excludes: (val, p) => !String(val).includes(p), // Alias for Go compatibility
                excludesall: (val, p) => ![...String(p)].some(char => String(val).includes(char)),
                startswith: (val, p) => String(val).startsWith(p),
                endswith: (val, p) => String(val).endsWith(p),
                startsnotwith: (val, p) => !String(val).startsWith(p),
                endsnotwith: (val, p) => !String(val).endsWith(p),
                oneof: (val, p) => p.split(/[, ]+/).includes(String(val)),
                neof: (val, p) => !p.split(/[, ]+/).includes(String(val)),
                boolean: (val) => ['true', 'false', '1', '0'].includes(String(val).toLowerCase()),
                
                // --- Files ---
                ext: (val, p, el) => {
                    if (!val) return true;
                    const allowed = p.toLowerCase().split(';').map(s => s.trim()).filter(Boolean);
                    if (el && el.files && el.files.length > 0) {
                        return Array.from(el.files).every(f => {
                            const fileExt = String(f.name).split('.').pop().toLowerCase();
                            return allowed.includes(fileExt);
                        });
                    }
                    const ext = String(val).split('.').pop().toLowerCase();
                    return allowed.includes(ext);
                },
                image: (val, _, el) => this.rules.ext(val, 'jpg;jpeg;png;gif;bmp;webp;svg;tiff;ico', el)
            };
            
            // Aliases & Legacy
            this.rules.ip = (val) => this.rules.ipv4(val) || this.rules.ipv6(val);
            this.rules.iscolor = this.rules.hexcolor;
            this.rules.country_code = (val) => /^[A-Z]{2}$/.test(val);
        }
        _parseRules(rulesStr) {
            const rawTokens = rulesStr.split(',').map(r => r.trim()).filter(Boolean);
            const parsed = [];

            for (const token of rawTokens) {
                let name = token, param = null;
                const eqIdx = token.indexOf('=');
                const colIdx = token.indexOf(':');

                if (eqIdx !== -1 && (colIdx === -1 || eqIdx < colIdx)) {
                    name = token.slice(0, eqIdx).trim();
                    param = token.slice(eqIdx + 1).trim();
                } else if (colIdx !== -1) {
                    name = token.slice(0, colIdx).trim();
                    param = token.slice(colIdx + 1).trim();
                } else if (parsed.length > 0 && !this.rules[name] && name !== 'omitempty') {
                    // Support comma-separated params for list rules like oneof:a,b,c or neof:a,b,c
                    const prev = parsed[parsed.length - 1];
                    if (prev.name === 'oneof' || prev.name === 'neof') {
                        prev.param = prev.param ? `${prev.param},${name}` : name;
                        continue;
                    }
                }

                parsed.push({ name, param });
            }
            return parsed;
        }

        validate(value, rulesStr, el) {
            if (!rulesStr) return { valid: true };
            const parsedRules = this._parseRules(rulesStr);

            for (const { name, param } of parsedRules) {
                const fn = this.rules[name];
                if (!fn) continue;

                // "Required" rules run always. Others skip if empty.
                const isEmpty = (value === null || value === '' || value === undefined || (Array.isArray(value) && value.length === 0));
                const isRequiredRule = ['required', 'required_with', 'required_without'].includes(name);

                if (!isRequiredRule && isEmpty) continue;

                if (!fn(value, param, el)) {
                    return { valid: false, failed: name, param: param };
                }
            }
            return { valid: true };
        }
    }

    // --- Main Library Class ---

    class KrisForm {
        constructor(element, options = {}) {
            if (!element) throw new Error("KrisForm: Element required");
            
            this.el = element;
            this.config = this._mergeConfig(options);
            this.dependencies = options.dependencies || [];
            
            this.validator = new Validator();
            
            // State
            this.state = {
                isDirty: false,
                initialValues: new Map(), // Element -> Value
                lastCommittedValues: new Map() // FieldName -> Value (for dependency triggers)
            };

            this.dependencyMap = new Map();

            // Bind methods for Event Listeners to allow removal later
            this._handleInput = this._handleInput.bind(this);
            this._handleChange = this._handleChange.bind(this);
            this._handleFocusOut = this._handleFocusOut.bind(this);
            this._handleSubmit = this._handleSubmit.bind(this);
            this._handleReset = this._handleReset.bind(this);

            this.init();
        }

        /**
         * Deep merge configuration
         */
        _mergeConfig(options) {
            return {
                ...DEFAULTS,
                ...options,
                selectors: { ...DEFAULTS.selectors, ...(options.selectors || {}) },
                classes: { ...DEFAULTS.classes, ...(options.classes || {}) },
                i18n: { ...DEFAULTS.i18n, ...(options.i18n || {}) }
            };
        }

        init() {
            this._groupDependencies();
            this._snapshotState();
            this._bindEvents();
            
            // Initial calculation
            this.updateAllDependencies(true);
        }

        /**
         * Clean up listeners, pending timers, and memory
         */
        destroy() {
            this.el.removeEventListener('input', this._handleInput);
            this.el.removeEventListener('change', this._handleChange);
            this.el.removeEventListener('focusout', this._handleFocusOut);
            this.el.removeEventListener('submit', this._handleSubmit);
            this.el.removeEventListener('reset', this._handleReset);

            const validatorNodes = this.el.querySelectorAll(`[${CONSTANTS.ATTR.VALIDATOR}]`);
            validatorNodes.forEach(node => {
                if (node._krisValTimeout) {
                    clearTimeout(node._krisValTimeout);
                    delete node._krisValTimeout;
                }
                if (node._krisAsyncTimeout) {
                    clearTimeout(node._krisAsyncTimeout);
                    delete node._krisAsyncTimeout;
                }
                delete node._krisAsyncPending;
            });
            
            this.state.initialValues.clear();
            this.state.lastCommittedValues.clear();
            this.dependencyMap.clear();
        }

        _groupDependencies() {
            this.dependencies.forEach(dep => {
                const sources = dep.source.split(',').map(s => s.trim());
                sources.forEach(sourceName => {
                    if (!this.dependencyMap.has(sourceName)) {
                        this.dependencyMap.set(sourceName, []);
                    }
                    this.dependencyMap.get(sourceName).push(dep);
                });
            });
        }

        _snapshotState() {
            const fields = this.el.querySelectorAll('input, select, textarea');
            for (const el of fields) {
                if (!el.name || el.name === '_csrf') continue;
                this.state.initialValues.set(el, Utils.getFieldValue([el]));
                
                // Initialize dependency tracker
                if (!this.state.lastCommittedValues.has(el.name)) {
                     this.state.lastCommittedValues.set(el.name, this.getFieldValue(el.name));
                }
            }
        }

        _bindEvents() {
            // Use Event Delegation for performance
            this.el.addEventListener('input', this._handleInput);
            this.el.addEventListener('change', this._handleChange);
            this.el.addEventListener('focusout', this._handleFocusOut);
            this.el.addEventListener('submit', this._handleSubmit);
            this.el.addEventListener('reset', this._handleReset);
        }

        _handleReset() {
            setTimeout(() => {
                if (!this.el) return;
                this.el.querySelectorAll(`[${CONSTANTS.ATTR.VALIDATOR}]`).forEach(el => this.clearError(el));
                this.updateAllDependencies(true);
                this._checkDirty();
            }, 0);
        }

        // --- Event Handlers (Delegated) ---

        _resolveValidatorTarget(target) {
            if (!target || !(target instanceof Element)) return null;
            if (target.matches(`[${CONSTANTS.ATTR.VALIDATOR}]`)) {
                const ctrl = Utils.resolveControl(target);
                if (ctrl && ctrl !== target && ctrl.hasAttribute(CONSTANTS.ATTR.VALIDATOR)) {
                    return ctrl;
                }
                return target;
            }
            const ancestor = target.closest(`[${CONSTANTS.ATTR.VALIDATOR}]`);
            if (ancestor && this.el.contains(ancestor)) {
                const ctrl = Utils.resolveControl(ancestor);
                if (ctrl === target || target.isContentEditable || (target.closest && target.closest('[contenteditable="true"]'))) {
                    return ctrl && ctrl.hasAttribute(CONSTANTS.ATTR.VALIDATOR) ? ctrl : ancestor;
                }
            }
            if (target.isContentEditable || (target.closest && target.closest('[contenteditable="true"]'))) {
                const scope = target.closest(this.config.selectors.innerWrapper) || Utils.findFieldContainer(target, this.config);
                if (scope) {
                    return scope.querySelector(`textarea[${CONSTANTS.ATTR.VALIDATOR}], input[${CONSTANTS.ATTR.VALIDATOR}], select[${CONSTANTS.ATTR.VALIDATOR}], [${CONSTANTS.ATTR.VALIDATOR}]`);
                }
            }
            return null;
        }

        _handleInput(e) {
            const el = e.target;
            // Dirty check on global form level
            this._checkDirty();

            const valEl = this._resolveValidatorTarget(el);
            // Validate on input
            if (valEl) {
                const mode = this.config.validationMode;
                
                if (mode !== 'blur') {
                    const runValidation = () => {
                        if (mode === 'lazy') {
                            // Lazy mode: validate on input ONLY if field is already invalid (to clear error)
                            // Initial validation happens on blur
                            const visEl = Utils.resolveVisualElement(valEl, this.config);
                            if (valEl.classList.contains(this.config.classes.invalid[0]) || (visEl && visEl.classList.contains(this.config.classes.invalid[0]))) {
                                this.validateField(valEl);
                            }
                        } else {
                            // Immediate or Delayed mode
                            this.validateField(valEl);
                        }
                    };

                    if (mode === 'delayed') {
                        if (valEl._krisValTimeout) clearTimeout(valEl._krisValTimeout);
                        valEl._krisValTimeout = setTimeout(() => {
                            runValidation();
                            delete valEl._krisValTimeout;
                        }, this.config.validationDelay);
                    } else {
                        runValidation();
                    }
                }
            }

            // Dependencies (Instant)
            // Only process dependencies that don't require confirmation/Change event
            if (el.name && this.dependencyMap.has(el.name)) {
                this._processDependenciesForField(el.name, false);
            }
        }

        _handleChange(e) {
            const el = e.target;
            this._checkDirty();

            const valEl = this._resolveValidatorTarget(el);
            if (valEl) {
                this.validateField(valEl);
            }

            // Dependencies (With potential confirmation)
            if (el.name && this.dependencyMap.has(el.name)) {
                this._handleDependencyChange(el);
            }
        }

        _handleFocusOut(e) {
            const valEl = this._resolveValidatorTarget(e.target);
            if (!valEl) return;
            if (valEl !== e.target && e.relatedTarget) {
                const container = Utils.findFieldContainer(valEl, this.config);
                if (container && container.contains(e.relatedTarget)) return;
            }
            this.validateField(valEl);
        }

        _handleSubmit(e) {
            if (!this.validateAll()) {
                e.preventDefault();
                e.stopPropagation();
                this.scrollToError();
            }
        }

        // --- Logic ---

        _checkDirty() {
            let dirty = false;
            // Iterate over initial values (WeakMap-like behavior not needed as we track elements)
            for (const [el, initialVal] of this.state.initialValues.entries()) {
                // Check if element is still in DOM
                if (document.body.contains(el)) {
                     const currentVal = Utils.getFieldValue([el]);
                     if (String(currentVal) !== String(initialVal)) {
                         // Skip invalid file inputs typically cleared by browser
                         if (el.type === 'file' && el.classList.contains(this.config.classes.invalid[0])) {
                             continue;
                         }
                         dirty = true;
                         break;
                     }
                }
            }
            
            if (this.state.isDirty !== dirty) {
                this.state.isDirty = dirty;
                this.el.dispatchEvent(new CustomEvent(CONSTANTS.EVENT_NAMESPACE + ':dirty', { bubbles: true, detail: { dirty } }));
            }
        }

        // --- Validation ---

        validateField(el) {
            const isFile = el.type === 'file';
            // Validation Logic: Skip invisible/disabled unless it's a file input (which might be styled hidden)
            if (!isFile && (el.disabled || !Utils.isVisible(el))) {
                this.clearError(el);
                return true;
            }

            let rules = el.getAttribute(CONSTANTS.ATTR.VALIDATOR) || "";
                        // Integration: If HTML5 required property is set (statically or dynamically), enforce it in validation
                        if (el.required && !/(^|,)required($|,|:)/.test(rules)) {
                            rules = rules ? `required,${rules}` : 'required';
                        }

                        const value = this._getElValue(el);
                        const result = this.validator.validate(value, rules, el);

            if (!result.valid) {
                // If sync validation fails, cancel any pending async checks
                if (el._krisAsyncTimeout) clearTimeout(el._krisAsyncTimeout);
                delete el._krisAsyncPending;
                
                this.setError(el, result.failed, result.param);
                return false;
            }

            // Synchronous pass OK. Check for async rules.
            const remoteMatch = rules.match(/remote:([^,]+)/);
            if (remoteMatch) {
                return this._validateRemote(el, value, remoteMatch[1]);
            }

            this.clearError(el);
            return true;
        }

        /**
         * Handles async remote validation.
         * Returns 'false' immediately to block submit until server responds.
         */
        _validateRemote(el, value, urlPath) {
            // If empty (and not required), skip remote check
            if (value === '' || value === null) {
                this.clearError(el);
                return true;
            }

            // Cache check
            const cacheKey = `${urlPath}:${value}`;
            if (el._krisAsyncCache && el._krisAsyncCache[cacheKey] !== undefined) {
                const cached = el._krisAsyncCache[cacheKey];
                if (cached.valid) {
                    this.clearError(el);
                    return true;
                } else {
                    this.setError(el, 'remote', null, cached.message);
                    return false;
                }
            }

            // Debounce
            if (el._krisAsyncTimeout) clearTimeout(el._krisAsyncTimeout);
            
            // Set pending state (UI)
            el._krisAsyncPending = true;
            el.classList.add('is-loading'); // Optional: CSS can show spinner
            
            el._krisAsyncTimeout = setTimeout(() => {
                let url = this.config.endpoint ? this.config.endpoint + urlPath : urlPath;
                if (!Utils.isSafeUrl(url)) {
                    el.classList.remove('is-loading');
                    delete el._krisAsyncPending;
                    return;
                }
                const encodedVal = encodeURIComponent(value);
                
                if (url.includes('{value}')) {
                    url = url.replace('{value}', encodedVal);
                } else {
                    const separator = url.includes('?') ? '&' : '?';
                    url += `${separator}value=${encodedVal}`;
                }

                fetch(url)
                    .then(r => r.json())
                    .then(data => {
                        // Cache result
                        if (!el._krisAsyncCache) el._krisAsyncCache = {};
                        el._krisAsyncCache[cacheKey] = data;

                        // Ensure value hasn't changed while request was in flight
                        if (this._getElValue(el) === value) {
                            if (data.valid) {
                                this.clearError(el);
                                // If triggered by submit (and this was the only error), user has to click submit again 
                                // or we could trigger a custom event.
                            } else {
                                this.setError(el, 'remote', null, data.message);
                            }
                        }
                    })
                    .catch(console.error)
                    .finally(() => {
                        el.classList.remove('is-loading');
                        delete el._krisAsyncPending;
                    });
            }, 500); // Fixed 500ms delay for remote checks

            return false;
        }

        validateAll() {
            let valid = true;
            const inputs = this.el.querySelectorAll(`[${CONSTANTS.ATTR.VALIDATOR}]`);
            // Convert to array to avoid live NodeList issues
            const inputsArr = Array.from(inputs);
            const seenControls = new Set();
            
            for (const el of inputsArr) {
                const ctrl = Utils.resolveControl(el);
                if (ctrl && ctrl !== el && ctrl.hasAttribute(CONSTANTS.ATTR.VALIDATOR)) {
                    el.classList.remove(...this.config.classes.invalid);
                    continue;
                }
                if (seenControls.has(ctrl)) continue;
                seenControls.add(ctrl);
                if (!this.validateField(el)) valid = false;
            }
            return valid;
        }

        /**
         * Asynchronous field validation (waits for remote rule if present)
         * @param {HTMLElement} el
         * @returns {Promise<boolean>}
         */
        async validateFieldAsync(el) {
            const syncValid = this.validateField(el);
            if (syncValid) return true;
            if (!el._krisAsyncPending) return false;

            const rules = el.getAttribute(CONSTANTS.ATTR.VALIDATOR) || "";
            const remoteMatch = rules.match(/remote:([^,]+)/);
            if (!remoteMatch) return false;

            if (el._krisAsyncTimeout) {
                clearTimeout(el._krisAsyncTimeout);
                delete el._krisAsyncTimeout;
            }

            const urlPath = remoteMatch[1];
            const value = this._getElValue(el);
            const cacheKey = `${urlPath}:${value}`;
            let url = this.config.endpoint ? this.config.endpoint + urlPath : urlPath;
            if (!Utils.isSafeUrl(url)) {
                el.classList.remove('is-loading');
                delete el._krisAsyncPending;
                return false;
            }

            const encodedVal = encodeURIComponent(value);
            if (url.includes('{value}')) {
                url = url.replace('{value}', encodedVal);
            } else {
                const separator = url.includes('?') ? '&' : '?';
                url += `${separator}value=${encodedVal}`;
            }

            try {
                const resp = await fetch(url);
                const data = await resp.json();
                if (!el._krisAsyncCache) el._krisAsyncCache = {};
                el._krisAsyncCache[cacheKey] = data;

                if (data.valid) {
                    this.clearError(el);
                    return true;
                } else {
                    this.setError(el, 'remote', null, data.message);
                    return false;
                }
            } catch (e) {
                console.error(e);
                return false;
            } finally {
                el.classList.remove('is-loading');
                delete el._krisAsyncPending;
            }
        }

        /**
         * Asynchronous form validation (resolves all sync & remote validators)
         * @returns {Promise<boolean>}
         */
        async validateAllAsync() {
            const inputs = this.el.querySelectorAll(`[${CONSTANTS.ATTR.VALIDATOR}]`);
            const inputsArr = Array.from(inputs);
            const seenControls = new Set();
            let valid = true;

            for (const el of inputsArr) {
                const ctrl = Utils.resolveControl(el);
                if (ctrl && ctrl !== el && ctrl.hasAttribute(CONSTANTS.ATTR.VALIDATOR)) {
                    el.classList.remove(...this.config.classes.invalid);
                    continue;
                }
                if (seenControls.has(ctrl)) continue;
                seenControls.add(ctrl);
                const fieldValid = await this.validateFieldAsync(el);
                if (!fieldValid) valid = false;
            }
            return valid;
        }

        setError(el, rule, param, customMsg = null) {
            const visualEl = Utils.resolveVisualElement(el, this.config);
            el.classList.add(...this.config.classes.invalid);
            if (visualEl !== el) {
                visualEl.classList.add(...this.config.classes.invalid);
            }
            
            let feedback = this._findFeedback(visualEl);
            if (!feedback) {
                // Create feedback element if missing
                feedback = document.createElement('div');
                feedback.className = this.config.selectors.feedback.replace('.', '');
                const container = visualEl.closest('.input-group') || visualEl.parentElement;
                if (container) container.appendChild(feedback);
            }
            
            let msg = customMsg;
            
            if (!msg) {
                const globalI18n = global.KrisFormTranslateMessages || {};
                const localI18n = this.config.i18n || {};
                const ctrl = Utils.resolveControl(el);
                // Look for data-msg-rule attribute first
                msg = el.getAttribute(`data-msg-${rule}`) || (ctrl && ctrl !== el ? ctrl.getAttribute(`data-msg-${rule}`) : null);
                
                if (!msg) {
                    const tpl = localI18n[rule] || globalI18n[rule];
                    const defTpl = localI18n.default || globalI18n.default;
                    if (tpl) {
                        msg = tpl.replace('%s', param || '');
                    } else if (defTpl) {
                        msg = defTpl.replace('%s', rule);
                    } else {
                        msg = `${localI18n.defaultError || DEFAULTS.i18n.defaultError}: ${rule}`;
                    }
                }
            }
            
            // SECURITY: Use textContent
            Utils.setText(feedback, msg);
            feedback.style.display = 'block';
        }

        clearError(el) {
            const visualEl = Utils.resolveVisualElement(el, this.config);
            el.classList.remove(...this.config.classes.invalid);
            if (visualEl !== el) {
                visualEl.classList.remove(...this.config.classes.invalid);
            }
            const feedback = this._findFeedback(visualEl);
            if (feedback) feedback.style.display = 'none';
            if (visualEl !== el) {
                const innerFeedback = this._findFeedback(el);
                if (innerFeedback) innerFeedback.style.display = 'none';
            }
        }

        scrollToError() {
            const firstError = this.el.querySelector(`.${this.config.classes.invalid[0]}`);
            if (firstError) {
                const visualEl = Utils.resolveVisualElement(firstError, this.config);
                visualEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        _findFeedback(el) {
            if (!el) return null;
            // Strategy 1: Next sibling
            let sib = el.nextElementSibling;
            const cls = this.config.selectors.feedback.replace('.', '');
            while(sib) {
                if(sib.classList.contains(cls)) return sib;
                sib = sib.nextElementSibling;
            }
            // Strategy 2: Parent search
            return el.parentElement ? el.parentElement.querySelector(this.config.selectors.feedback) : null;
        }

        _getElValue(el) {
            const ctrl = Utils.resolveControl(el);
            if (ctrl.type === 'checkbox') return ctrl.checked ? ctrl.value : '';
            if (ctrl.type === 'radio') {
                if (ctrl.checked) return ctrl.value;
                if (ctrl.name && this.el) {
                    const group = Utils.findFieldElements(this.el, ctrl.name);
                    return Utils.getFieldValue(group) || '';
                }
                return '';
            }
            if (ctrl.tagName === 'SELECT' && ctrl.multiple) {
                return Array.from(ctrl.selectedOptions, opt => opt.value);
            }
            if (ctrl.value !== undefined) return ctrl.value;
            if (ctrl.hasAttribute && ctrl.hasAttribute('data-value')) return ctrl.getAttribute('data-value');
            return ctrl.textContent || '';
        }

        // --- Dependencies ---

        _handleDependencyChange(el) {
            const sourceName = el.name;
            const deps = this.dependencyMap.get(sourceName);
            if (!deps) return;

            const val = this.getFieldValue(sourceName);
            const stateProvider = (attr) => this.getFieldState(sourceName, attr);
            const fieldProvider = (name) => this.getFieldValue(name);

            let confirmMsg = null;
            
            // Check if any satisfied dependency requires confirmation
            for (const dep of deps) {
                if (dep.confirm && Evaluator.evaluate(dep.condition, val, stateProvider, fieldProvider)) {
                    confirmMsg = dep.confirm;
                    break;
                }
            }

            if (confirmMsg) {
                const i18n = global.KrisFormTranslateMessages || {};
                const message = i18n[confirmMsg] ? i18n[confirmMsg] : confirmMsg;

                // Callbacks
                const onConfirm = () => {
                    this.state.lastCommittedValues.set(sourceName, val);
                    this._processDependenciesForField(sourceName, true);
                    this._checkDirty();
                };
                
                const onCancel = () => {
                    const oldVal = this.state.lastCommittedValues.get(sourceName);
                    Utils.setElementValue(el, oldVal);
                    setTimeout(() => this._processDependenciesForField(sourceName, true), 0);
                };

                // 1. Dispatch event for UI Adapters
                const event = new CustomEvent(CONSTANTS.EVENT_NAMESPACE + ':confirm', {
                    bubbles: true,
                    cancelable: true,
                    detail: {
                        message: message,
                        onConfirm: onConfirm,
                        onCancel: onCancel,
                        trigger: el
                    }
                });

                const allowed = this.el.dispatchEvent(event);

                // 2. Fallback to native confirm if no one prevented default
                if (allowed) {
                    if (confirm(message)) {
                        onConfirm();
                    } else {
                        onCancel();
                    }
                }

            } else {
                this.state.lastCommittedValues.set(sourceName, val);
                this._processDependenciesForField(sourceName, true);
            }
        }

        _processDependenciesForField(sourceName, isChange, isInit = false) {
            const deps = this.dependencyMap.get(sourceName);
            if (!deps) return;

            const val = this.getFieldValue(sourceName);
            const stateProvider = (attr) => this.getFieldState(sourceName, attr);
            const fieldProvider = (name) => this.getFieldValue(name);

            // Block instant updates if any dependency requires confirmation for this state
            if (!isChange) {
                for (const dep of deps) {
                    if (dep.confirm && Evaluator.evaluate(dep.condition, val, stateProvider, fieldProvider)) {
                        return; 
                    }
                }
            }

            deps.forEach(dep => {
                // Skip confirm actions during input phase (wait for change)
                if (!isChange && dep.confirm) return;

                const isMet = Evaluator.evaluate(dep.condition, val, stateProvider, fieldProvider);
                
                if (dep.target) {
                    const targets = dep.target.split(",").map(s => s.trim()).filter(Boolean);
                    targets.forEach(targetName => {
                        const elements = Utils.findFieldElements(this.el, targetName);
                        elements.forEach(el => {
                            const container = Utils.findFieldContainer(el, this.config);
                            
                            const actionName = isMet ? dep.action : (dep.inverse_action || this._getInverseAction(dep.action));
                            const delay = (isMet && dep.time) ? parseInt(dep.time, 10) : 0;

                            if (delay > 0) {
                                setTimeout(() => {
                                    this._applyAction(el, container, actionName, val, isInit);
                                }, delay);
                            } else {
                                this._applyAction(el, container, actionName, val, isInit);
                            }
                            
                            if (dep.message) {
                                this._updateStatusMessage(container, dep.message, isMet);
                            }

                            // Data Loading Logic
                            if (isMet && dep['data-url']) {
                                this._loadDependencyData(dep['data-url'], el, val, isInit);
                            }
                        });
                    });
                }
            });
        }

        /**
         * Fetches data from endpoint and populates target
         */
        _loadDependencyData(urlPath, targetEl, sourceValue, isInit = false) {
            // Prevent spamming requests for the same value
            const cacheKey = `${urlPath}:${sourceValue}`;
            if (targetEl._lastLoadedValue === cacheKey) return;

            // [Security/Performance] Prevent race condition: if request for this key is pending, skip
            if (targetEl._pendingLoadKey === cacheKey) return;
            targetEl._pendingLoadKey = cacheKey;

            let url = this.config.endpoint ? this.config.endpoint + urlPath : urlPath;
            if (!Utils.isSafeUrl(url)) {
                delete targetEl._pendingLoadKey;
                return;
            }
            const encodedVal = encodeURIComponent(sourceValue);

            // Support {value} placeholder or append as query param
            if (url.includes('{value}')) {
                url = url.replace('{value}', encodedVal);
            } else {
                const separator = url.includes('?') ? '&' : '?';
                url += `${separator}value=${encodedVal}`;
            }

            // Init request counter if not exists
            if (typeof targetEl._krisReqCount === 'undefined') {
                targetEl._krisReqCount = 0;
            }

            // Capture original state ONLY on the first request
            if (targetEl._krisReqCount === 0) {
                targetEl._krisOrigOpacity = targetEl.style.opacity;
                targetEl._krisOrigPointer = targetEl.style.pointerEvents;
                
                // Apply loading state
                targetEl.style.opacity = '0.5';
                targetEl.style.pointerEvents = 'none';
            }

            // Increment active requests
            targetEl._krisReqCount++;

            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error("Network response was not ok");
                    return response.json();
                })
                .then(data => {
                    this._populateTarget(targetEl, data, isInit);
                    targetEl._lastLoadedValue = cacheKey;
                })
                .catch(error => {
                    console.warn("[KrisForm] Data load failed:", error);
                })
                .finally(() => {
                    // Cleanup pending flag to allow retry on next interaction if needed
                    if (targetEl._pendingLoadKey === cacheKey) {
                        delete targetEl._pendingLoadKey;
                    }

                    targetEl._krisReqCount--;
                    
                    // Only restore state when ALL active requests are finished
                    if (targetEl._krisReqCount <= 0) {
                        targetEl._krisReqCount = 0; // Reset to be safe
                        targetEl.style.opacity = targetEl._krisOrigOpacity;
                        targetEl.style.pointerEvents = targetEl._krisOrigPointer;
                        
                        // Cleanup temp properties
                        delete targetEl._krisOrigOpacity;
                        delete targetEl._krisOrigPointer;
                    }
                });
        }

        _populateTarget(el, data, isInit = false) {
            if (el.tagName === 'SELECT') {
                // Clear existing options (except placeholder if any?) 
                // Strategy: If first option has empty value, keep it as placeholder.
                let placeholder = null;
                if (el.options.length > 0 && el.options[0].value === "") {
                    placeholder = el.options[0].cloneNode(true);
                }

                el.innerHTML = '';
                if (placeholder) el.appendChild(placeholder);

                if (Array.isArray(data)) {
                    data.forEach(item => {
                        const opt = document.createElement('option');
                        // Support both simple array [val1, val2] and object array [{value, label}]
                        if (typeof item === 'object' && item !== null) {
                            opt.value = item.value !== undefined ? item.value : item.id;
                            opt.textContent = item.label || item.name || item.title || item.value;
                        } else {
                            opt.value = item;
                            opt.textContent = item;
                        }
                        el.appendChild(opt);
                    });
                }

                // Restore saved value on initialization (via data-value attribute)
                if (isInit) {
                    const savedVal = el.getAttribute('data-value');
                    if (savedVal) {
                        Utils.setElementValue(el, savedVal);
                    }
                }
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                // For inputs, just set the value (assuming API returns a single value string/number or object with value)
                let val = data;
                if (typeof data === 'object' && data !== null && data.value !== undefined) {
                    val = data.value;
                }
                Utils.setElementValue(el, val);
            }
            
            // Trigger change to propagate updates
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        updateAllDependencies(isInit = false) {
            for (const [sourceName] of this.dependencyMap.entries()) {
                this._processDependenciesForField(sourceName, true, isInit);
            }
        }

        _applyAction(el, container, actionStr, sourceValue, isInit = false) {
            if (!actionStr) return;
            const colonIdx = actionStr.indexOf(":");
            const action = colonIdx === -1 ? actionStr : actionStr.slice(0, colonIdx);
            const param = colonIdx === -1 ? "" : actionStr.slice(colonIdx + 1);
            const isHidden = !Utils.isVisible(el);
            
            const actions = {
                enable: () => this._toggleFieldState(el, container, true),
                disable: () => this._toggleFieldState(el, container, false),
                readonly: () => { Utils.resolveControl(el).readOnly = true; },
                editable: () => { Utils.resolveControl(el).readOnly = false; },
                show: () => this._toggleVisibility(el, container, true),
                hide: () => this._toggleVisibility(el, container, false),
                required: () => this._toggleRequired(el, container, true, isHidden),
                optional: () => this._toggleRequired(el, container, false, isHidden),
                set_value: () => !isHidden && Utils.setElementValue(el, param),
                check: () => !isHidden && (Utils.resolveControl(el).checked = true),
                uncheck: () => !isHidden && (Utils.resolveControl(el).checked = false),
                add_class: () => container && !isHidden && param && container.classList.add(...param.split(" ").filter(Boolean)),
                remove_class: () => container && !isHidden && param && container.classList.remove(...param.split(" ").filter(Boolean)),
                focus: () => !isHidden && setTimeout(() => Utils.resolveControl(el).focus(), 50),
                clear: () => !isHidden && Utils.setElementValue(el, ''),
                filter_options: () => this._filterOptions(el, sourceValue),
                
                // Computed Value Action
                // Syntax: set_computed_value:max(fields.a + fields.b)
                set_computed_value: () => {
                    if (isHidden) return;
                    // Prepare context for Evaluator
                    const stateProvider = (attr) => this.getFieldState(sourceValue, attr); // Source context (less relevant here)
                    const fieldProvider = (name) => this.getFieldValue(name);
                    const context = { value: sourceValue }; // current source value
                    
                    const result = Evaluator._evaluateRecursive(param, context, fieldProvider);
                    Utils.setElementValue(el, result);
                }
            };

            if (actions[action]) {
                actions[action]();
                // Trigger events if value changed programmatically to ripple effects
                if (["set_value", "check", "uncheck", "clear"].includes(action) && !isHidden) {
                     el.dispatchEvent(new Event("change", { bubbles: true }));
                     el.dispatchEvent(new Event("input", { bubbles: true }));
                }
                // Re-validate if state changed (e.g. became required or visible)
                // Skip validation during initialization to avoid red fields on page load
                if (!isInit && el.hasAttribute(CONSTANTS.ATTR.VALIDATOR)) this.validateField(el);
            }
        }

        _toggleFieldState(el, container, enable) {
            el.disabled = !enable;
            // Also handle readonly if semantic logic dictates (not standard but useful)
            if (container) {
                const wrapper = container.querySelector(this.config.selectors.innerWrapper) || container;
                if (enable) {
                    wrapper.classList.remove(...this.config.classes.disabled);
                    wrapper.style.pointerEvents = "";
                } else {
                    wrapper.classList.add(...this.config.classes.disabled);
                    // wrapper.style.pointerEvents = "none"; // Optional: blocks clicks
                }
            }
        }

        _toggleVisibility(el, container, show) {
            if (container) {
                if (show) {
                    container.classList.remove(...this.config.classes.hidden);
                    container.style.display = "";
                    container.hidden = false;
                } else {
                    container.classList.add(...this.config.classes.hidden);
                    container.style.display = "none";
                    container.hidden = true;
                }
            }
            // Also toggle element directly if no container
            el.hidden = !show;
            if (!show) el.style.display = "none";
            else el.style.display = "";
        }

        _toggleRequired(el, container, required, isHidden) {
            if (!isHidden) el.required = required;
            if (container) {
                if (required) container.classList.add(...this.config.classes.required);
                else container.classList.remove(...this.config.classes.required);
            }
        }

        _filterOptions(target, allowedValuesStr) {
            if (!target || target.tagName !== 'SELECT') return;
            
            let allowed = [];
            if (allowedValuesStr) {
                allowed = Array.isArray(allowedValuesStr) ? allowedValuesStr : String(allowedValuesStr).split(',').map(s => s.trim());
                allowed = allowed.map(String);
            }
    
            const currentVal = target.value;
            let currentIsValid = false;
            let firstValid = null;
    
            for (let i = 0; i < target.options.length; i++) {
                const opt = target.options[i];
                const val = opt.value;
                const isAllowed = allowed.includes(val);
                
                if (isAllowed) {
                    opt.hidden = false;
                    opt.disabled = false;
                    if (firstValid === null) firstValid = val;
                    if (val === currentVal) currentIsValid = true;
                } else {
                    opt.hidden = true;
                    opt.disabled = true;
                }
            }
    
            if (!currentIsValid) {
                target.value = firstValid !== null ? firstValid : "";
                target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        _updateStatusMessage(container, messageKey, show) {
            if (!container) return;
            const msgBox = container.querySelector(this.config.selectors.statusMessage);
            if (!msgBox) return;

            const textEl = msgBox.querySelector(this.config.selectors.statusText);
            if (show && messageKey) {
                const globalI18n = global.KrisFormTranslateMessages || {};
                const localI18n = this.config.i18n || {};
                if (textEl) {
                    const rawMsg = localI18n[messageKey] || globalI18n[messageKey] || messageKey;
                    textEl.innerHTML = Utils.sanitizeHTML(rawMsg);
                }
                msgBox.classList.remove('d-none');
            } else {
                if (textEl) textEl.innerHTML = '';
                msgBox.classList.add('d-none');
            }
        }

        _getInverseAction(action) {
            const map = {
                enable: "disable", disable: "enable",
                show: "hide", hide: "show",
                required: "optional", optional: "required",
                readonly: "editable", editable: "readonly"
            };
            return map[action.split(':')[0]] || null;
        }

        getFieldValue(name) {
            const els = Utils.findFieldElements(this.el, name);
            return Utils.getFieldValue(els);
        }

        getFieldState(name, attr) {
            const els = Utils.findFieldElements(this.el, name);
            if (!els.length) return null;
            
            // Heuristics to find the "main" element for attribute checking
            let el = els[0];
            const checkboxes = els.filter(e => e.type === 'checkbox');
            if (checkboxes.length === 1) el = checkboxes[0];
            else {
                const nonHidden = els.find(e => e.type !== 'hidden');
                if (nonHidden) el = nonHidden;
            }

            if (attr === "checked") return el.checked;
            if (attr === "visible") return Utils.isVisible(el);
            if (attr === "disabled") return el.disabled;
            if (attr === "readonly") return el.readOnly;
            if (attr === "required") return el.required;
            
            return el.getAttribute(attr) || el[attr];
        }
    }

    // --- Expose Global API ---
    global.KrisForm = KrisForm;
    global.KrisFormValidator = Validator;
    global.KrisFormEvaluator = Evaluator; // Exposed for Unit Testing
    global.KrisFormUtils = Utils;

    // --- Module Export (for tests/bundlers) ---
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { KrisForm, Validator, Evaluator, Utils };
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));