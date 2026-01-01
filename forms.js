/**
 * KrisForm - Universal Form Library
 * Version: 2.2.0
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
        modalId: 'dependencyConfirmModal', // Configurable Modal ID
        i18n: {
            defaultError: "Validation failed",
            confirmTitle: "Confirm Action",
            confirm: "Confirm",
            cancel: "Cancel"
        }
    };

    // --- Utils ---

    const Utils = {
        /**
         * Safe check for element visibility
         * @param {HTMLElement} el 
         * @returns {boolean}
         */
        isVisible(el) {
            if (!el) return false;
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
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
            
            // Optimization: Early exit for single standard input
            if (elements.length === 1) {
                const el = elements[0];
                if (el.type === 'checkbox') return el.checked;
                if (el.type === 'radio') return el.checked ? el.value : null;
                return el.value;
            }

            // Group handling
            const checkboxes = [];
            const radios = [];
            let standard = null;

            for (const el of elements) {
                if (el.type === 'checkbox') checkboxes.push(el);
                else if (el.type === 'radio') radios.push(el);
                else if (!standard && el.type !== 'hidden') standard = el; // Prefer visible
            }

            if (checkboxes.length > 0) {
                if (checkboxes.length > 1) return checkboxes.filter(e => e.checked).map(e => e.value);
                return checkboxes[0].checked;
            }

            if (radios.length > 0) {
                const checked = radios.find(e => e.checked);
                return checked ? checked.value : null;
            }

            // Fallback to first element if logic above didn't catch (e.g. only hidden inputs)
            return standard ? standard.value : elements[0].value;
        },

        setElementValue(el, val) {
            if (el.type === "checkbox") {
                el.checked = (val === true || val === "true" || val === 1 || val === "1");
            } else if (el.type === "radio") {
                // For radio, we rely on the group logic, but if individual element is targeted:
                if (el.name) {
                    const radios = document.getElementsByName(el.name);
                    for(let i=0; i < radios.length; i++) {
                        radios[i].checked = (radios[i].value === String(val));
                    }
                } else {
                     el.checked = (el.value === String(val));
                }
            } else {
                el.value = (val === null || val === undefined) ? '' : val;
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
                if (this._findSplitIndex(expr.slice(1, -1), "__dummy__") === -1) {
                    expr = expr.slice(1, -1).trim();
                } else {
                    break;
                }
            }

            // Logical OR
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
                const idx = expr.indexOf(op);
                if (idx !== -1) {
                    const left = expr.substring(0, idx).trim();
                    const right = expr.substring(idx + op.length).trim();
                    return this._compare(
                        this._resolve(left, context, fieldProvider), 
                        this._resolve(right, context, fieldProvider), 
                        op
                    );
                }
            }

            // Method whitelist (Security)
            const ALLOWED_METHODS = ['includes', 'startsWith', 'endsWith'];
            for (const method of ALLOWED_METHODS) {
                const methodStr = `.${method}(`;
                if (expr.includes(methodStr)) {
                    return this._evalMethod(expr, context, method, fieldProvider);
                }
            }

            const val = this._resolve(expr, context, fieldProvider);
            return Boolean(val);
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
                return fieldProvider ? fieldProvider(expr.slice(7)) : null;
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
            return expr; // Fallback to string literal if not found
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
                    if (el.type === 'checkbox') return el.checked;
                    if (el.type === 'radio') return !!val;
                    if (val === undefined || val === null) return false;
                    return String(val).trim().length > 0;
                },
                required_with: (val, p, el) => {
                    const otherVal = getOtherVal(el, p);
                    if (otherVal && String(otherVal).length > 0) return this.rules.required(val, null, el);
                    return true;
                },
                required_without: (val, p, el) => {
                    const otherVal = getOtherVal(el, p);
                    if (!otherVal || String(otherVal).length === 0) return this.rules.required(val, null, el);
                    return true;
                },
                
                // --- Comparison ---
                eq: (val, p) => String(val) === String(p),
                ne: (val, p) => String(val) !== String(p),
                lt: (val, p) => Number(val) < Number(p),
                gt: (val, p) => Number(val) > Number(p),
                lte: (val, p) => Number(val) <= Number(p),
                gte: (val, p) => Number(val) >= Number(p),
                
                // Cross-Field Comparisons
                eqfield: (val, p, el) => String(val) === String(getOtherVal(el, p)),
                nefield: (val, p, el) => String(val) !== String(getOtherVal(el, p)),
                gtfield: (val, p, el) => Number(val) > Number(getOtherVal(el, p)),
                gtefield: (val, p, el) => Number(val) >= Number(getOtherVal(el, p)),
                ltfield: (val, p, el) => Number(val) < Number(getOtherVal(el, p)),
                ltefield: (val, p, el) => Number(val) <= Number(getOtherVal(el, p)),
                
                // --- Numeric / Range / Length ---
                len: (val, p) => String(val).length === Number(p),
                min: (val, p, el) => el.type === 'number' ? Number(val) >= Number(p) : String(val).length >= Number(p),
                max: (val, p, el) => el.type === 'number' ? Number(val) <= Number(p) : String(val).length <= Number(p),

                // --- Complexity (Count Matches) ---
                min_alpha: (val, p) => (String(val).match(/[a-zA-Z]/g) || []).length >= Number(p),
                min_upper: (val, p) => (String(val).match(/[A-Z]/g) || []).length >= Number(p),
                min_digit: (val, p) => (String(val).match(/[0-9]/g) || []).length >= Number(p),
                min_symbol: (val, p) => (String(val).match(/[^a-zA-Z0-9\s]/g) || []).length >= Number(p),

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
                rgba: (val) => /^rgba\(\s*(?:(?:\d{1,2}|1\d\d|2(?:[0-4]\d|5[0-5]))\s*,?){3}\s*\s*(?:[0-9]*\.[0-9]+|[0-9]+)\)$/.test(val),
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
                ext: (val, p) => {
                    if (!val) return true;
                    const ext = String(val).split('.').pop().toLowerCase();
                    const allowed = p.toLowerCase().split(';').map(s => s.trim());
                    return allowed.includes(ext);
                },
                image: (val) => this.rules.ext(val, 'jpg;jpeg;png;gif;bmp;webp;svg;tiff;ico')
            };
            
            // Aliases & Legacy
            this.rules.ip = (val) => this.rules.ipv4(val) || this.rules.ipv6(val);
            this.rules.iscolor = this.rules.hexcolor;
            this.rules.country_code = (val) => /^[A-Z]{2}$/.test(val);
        }
        validate(value, rulesStr, el) {
            if (!rulesStr) return { valid: true };
            const rules = rulesStr.split(',').map(r => r.trim());

            for (const r of rules) {
                let name = r, param = null;
                // Supports rule=param or rule:param
                if (r.includes('=')) [name, param] = r.split('=');
                else if (r.includes(':')) [name, param] = r.split(':');

                const fn = this.rules[name];
                if (!fn) continue;

                // "Required" runs always. Others skip if empty.
                const isEmpty = (value === null || value === '' || value === undefined);
                if (name !== 'required' && isEmpty) continue;

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
            this.modal = null;

            // Bind methods for Event Listeners to allow removal later
            this._handleInput = this._handleInput.bind(this);
            this._handleChange = this._handleChange.bind(this);
            this._handleFocusOut = this._handleFocusOut.bind(this);
            this._handleSubmit = this._handleSubmit.bind(this);

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
            this._initModal();
            this._groupDependencies();
            this._snapshotState();
            this._bindEvents();
            
            // Initial calculation
            this.updateAllDependencies(true);
        }

        /**
         * Clean up listeners and memory
         */
        destroy() {
            this.el.removeEventListener('input', this._handleInput);
            this.el.removeEventListener('change', this._handleChange);
            this.el.removeEventListener('focusout', this._handleFocusOut);
            this.el.removeEventListener('submit', this._handleSubmit);
            
            this.state.initialValues.clear();
            this.state.lastCommittedValues.clear();
            this.dependencyMap.clear();
            
            if (this.modal && typeof this.modal.dispose === 'function') {
                this.modal.dispose();
            }
        }

        _initModal() {
            const modalId = this.config.modalId || 'dependencyConfirmModal';
            const el = document.getElementById(modalId);
            
            // If no modal found, we just skip init. 
            // Logic will fallback to native confirm() if modal is missing at runtime.
            if (!el) return;

            // Strategy 1: Bootstrap 5 (Only if detected and requested via structure/config)
            // We use a heuristic: if it has 'modal-dialog' class, it's likely BS.
            const isBootstrap = el.querySelector('.modal-dialog') && global.bootstrap && global.bootstrap.Modal;
            
            if (isBootstrap) {
                try {
                    this.modal = new global.bootstrap.Modal(el);
                } catch (e) {
                    console.warn("[KrisForm] Bootstrap init failed", e);
                }
            } 

            // Strategy 2: Vanilla / Custom
            if (!this.modal) {
                this.modal = {
                    show: () => {
                        el.classList.add('show');
                        // Ensure it's visible if CSS relies on display property
                        if (getComputedStyle(el).display === 'none') el.style.display = 'flex'; 
                        document.body.classList.add('modal-open'); 
                    },
                    hide: () => {
                        el.classList.remove('show');
                        if (el.style.display === 'flex') el.style.display = '';
                        document.body.classList.remove('modal-open');
                    },
                    dispose: () => {}
                };
            }
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
        }

        // --- Event Handlers (Delegated) ---

        _handleInput(e) {
            const el = e.target;
            // Dirty check on global form level
            this._checkDirty();

            // Validate on input
            if (el.matches('[data-validator]')) {
                this.validateField(el);
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

            if (el.matches('[data-validator]')) {
                this.validateField(el);
            }

            // Dependencies (With potential confirmation)
            if (el.name && this.dependencyMap.has(el.name)) {
                this._handleDependencyChange(el);
            }
        }

        _handleFocusOut(e) {
            const el = e.target;
            if (el.matches('[data-validator]')) {
                this.validateField(el);
            }
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
                this.setError(el, result.failed, result.param);
                return false;
            } else {
                this.clearError(el);
                return true;
            }
        }

        validateAll() {
            let valid = true;
            const inputs = this.el.querySelectorAll(`[${CONSTANTS.ATTR.VALIDATOR}]`);
            // Convert to array to avoid live NodeList issues
            const inputsArr = Array.from(inputs);
            
            for (const el of inputsArr) {
                if (!this.validateField(el)) valid = false;
            }
            return valid;
        }

        setError(el, rule, param) {
            el.classList.add(...this.config.classes.invalid);
            
            let feedback = this._findFeedback(el);
            if (!feedback) {
                // Create feedback element if missing
                feedback = document.createElement('div');
                feedback.className = this.config.selectors.feedback.replace('.', '');
                const container = el.closest('.input-group') || el.parentElement;
                container.appendChild(feedback);
            }
            
            const i18n = global.KrisFormTranslateMessages || {};
            // Look for data-msg-rule attribute first
            let msg = el.getAttribute(`data-msg-${rule}`);
            
            if (!msg) {
                if (i18n[rule]) {
                    msg = i18n[rule].replace('%s', param || '');
                } else if (i18n.default) {
                    msg = i18n.default.replace('%s', rule);
                } else {
                    msg = `${this.config.i18n.defaultError}: ${rule}`;
                }
            }
            
            // SECURITY: Use textContent
            Utils.setText(feedback, msg);
            feedback.style.display = 'block';
        }

        clearError(el) {
            el.classList.remove(...this.config.classes.invalid);
            const feedback = this._findFeedback(el);
            if (feedback) feedback.style.display = 'none';
        }

        scrollToError() {
            const firstError = this.el.querySelector(`.${this.config.classes.invalid[0]}`);
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        _findFeedback(el) {
            // Strategy 1: Next sibling
            let sib = el.nextElementSibling;
            const cls = this.config.selectors.feedback.replace('.', '');
            while(sib) {
                if(sib.classList.contains(cls)) return sib;
                sib = sib.nextElementSibling;
            }
            // Strategy 2: Parent search
            return el.parentElement.querySelector(this.config.selectors.feedback);
        }

        _getElValue(el) {
            if (el.type === 'checkbox') return el.checked ? el.value : '';
            if (el.type === 'radio') return el.checked ? el.value : '';
            return el.value;
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
                // Find message element inside the specific modal container if possible, or global fallback
                const modalId = this.config.modalId || 'dependencyConfirmModal';
                const modalEl = document.getElementById(modalId);
                
                let msgEl = null;
                let btnOk = null;
                let btnCancel = null;

                if (modalEl) {
                    // Look inside the modal first (Best Practice for multiple modals)
                    msgEl = modalEl.querySelector('.confirm-message') || document.getElementById('dependencyConfirmMessage');
                    btnOk = modalEl.querySelector('.btn-confirm') || document.getElementById('btnConfirmOk');
                    btnCancel = modalEl.querySelector('.btn-cancel') || document.getElementById('btnConfirmCancel');
                } else {
                    // Global fallback
                    msgEl = document.getElementById('dependencyConfirmMessage');
                    btnOk = document.getElementById('btnConfirmOk');
                    btnCancel = document.getElementById('btnConfirmCancel');
                }

                const i18n = global.KrisFormTranslateMessages || {};
                
                if (msgEl) {
                    const text = i18n[confirmMsg] ? i18n[confirmMsg] : confirmMsg;
                    Utils.setText(msgEl, text);
                }

                // Dynamic Handlers
                const onConfirm = () => {
                    this.state.lastCommittedValues.set(sourceName, val);
                    this._processDependenciesForField(sourceName, true);
                    this._checkDirty();
                    cleanup();
                };
                
                const onCancel = () => {
                    const oldVal = this.state.lastCommittedValues.get(sourceName);
                    Utils.setElementValue(el, oldVal);
                    setTimeout(() => this._processDependenciesForField(sourceName, true), 0);
                    cleanup();
                };

                const cleanup = () => {
                    if (this.modal) this.modal.hide();
                    if(btnOk) btnOk.onclick = null;
                    if(btnCancel) btnCancel.onclick = null;
                };

                if (this.modal && modalEl) {
                    if(btnOk) btnOk.onclick = (e) => { e.preventDefault(); onConfirm(); };
                    if(btnCancel) btnCancel.onclick = (e) => { e.preventDefault(); onCancel(); };
                    this.modal.show();
                } else {
                    if (confirm(confirmMsg)) onConfirm(); 
                    else onCancel();
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
                        });
                    });
                }
            });
        }

        updateAllDependencies(isInit = false) {
            for (const [sourceName] of this.dependencyMap.entries()) {
                this._processDependenciesForField(sourceName, true, isInit);
            }
        }

        _applyAction(el, container, actionStr, sourceValue, isInit = false) {
            if (!actionStr) return;
            const [action, param] = actionStr.split(":");
            const isHidden = !Utils.isVisible(el);
            
            const actions = {
                enable: () => this._toggleFieldState(el, container, true),
                disable: () => this._toggleFieldState(el, container, false),
                show: () => this._toggleVisibility(el, container, true),
                hide: () => this._toggleVisibility(el, container, false),
                required: () => this._toggleRequired(el, container, true, isHidden),
                optional: () => this._toggleRequired(el, container, false, isHidden),
                set_value: () => !isHidden && Utils.setElementValue(el, param),
                check: () => !isHidden && (el.checked = true),
                uncheck: () => !isHidden && (el.checked = false),
                add_class: () => container && !isHidden && container.classList.add(...param.split(" ")),
                remove_class: () => container && !isHidden && container.classList.remove(...param.split(" ")),
                focus: () => !isHidden && setTimeout(() => el.focus(), 50),
                clear: () => !isHidden && Utils.setElementValue(el, ''),
                filter_options: () => this._filterOptions(el, sourceValue)
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
                const i18n = global.KrisFormTranslateMessages || {};
                if (textEl) {
                    // Allow HTML for links and formatting (Trusted source assumed)
                    textEl.innerHTML = i18n[messageKey] || messageKey;
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
    global.KrisFormUtils = Utils;

    // --- Module Export (for tests/bundlers) ---
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { KrisForm, Validator, Evaluator, Utils };
    }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));