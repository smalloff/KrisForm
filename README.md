# KrisForm

**KrisForm** is a secure, high-performance, vanilla JavaScript library for form validation, complex dependency management, and state handling. It requires no external dependencies (like jQuery) and is designed to be easily integrated into any web project.

[📘 **Detailed Documentation & Demo**](https://smalloff.github.io/KrisForm/)

## Features

*   🚀 **Zero Dependencies**: Pure Vanilla JS.
*   🛡️ **Secure**: Hardened expression evaluator and XSS-safe DOM manipulation.
*   ✅ ** extensive Validation**: Over 80+ built-in validation rules (Email, IP, Credit Card, UUID, etc.).
*   🧮 **Calculations**: Built-in math engine for computed fields (`max`, `min`, `sum` logic).
*   🔗 **Dependency Management**: Powerful logic engine to Show/Hide/Require fields based on other field values.
*   ⚡ **High Performance**: Debounced events and optimized DOM traversal.
*   🎨 **Customizable**: Configurable CSS classes, selectors, and error messages.
*   🌍 **I18n Support**: Easy localization for error messages.

## Installation

Include the script in your project:

```html
<script src="path/to/forms.min.js"></script>
<!-- Or forms.js for development -->
```

## Quick Start

### 1. HTML Structure

Add `data-validator` attributes to your inputs. Use `data-field-container` to mark the wrapper that should be styled (red border) or hidden via dependencies.

```html
<form id="myForm" novalidate>
    <!-- Simple Required Field -->
    <div class="mb-3" data-field-container>
        <label class="form-label">Username</label>
        <input type="text" name="username" class="form-control" 
               data-validator="required, min:3, max:20">
    </div>

    <!-- Email Field -->
    <div class="mb-3" data-field-container>
        <label class="form-label">Email</label>
        <input type="email" name="email" class="form-control" 
               data-validator="required, email">
    </div>

    <!-- Dependent Field (Initially Hidden via CSS or JS) -->
    <div class="mb-3" data-field-container id="container_reason">
        <label class="form-label">Reason</label>
        <textarea name="reason" class="form-control" 
                  data-validator="max:500"></textarea>
    </div>

    <button type="submit" class="btn btn-primary">Submit</button>
</form>
```

### 2. Initialization

Initialize the library with configuration and dependency rules.

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const formElement = document.getElementById('myForm');

    const krisForm = new KrisForm(formElement, {
        // Optional Configuration
        updateDelay: 100,
        classes: {
            invalid: ['is-invalid', 'border-danger']
        },
        
        // Dependency Logic
        dependencies: [
            {
                // If username is 'admin', show the reason field and make it required
                source: 'username',
                condition: "value === 'admin'",
                target: 'reason',
                action: 'show',     // actions: show, hide, enable, disable
                inverse_action: 'hide'
            },
            {
                source: 'username',
                condition: "value === 'admin'",
                target: 'reason',
                action: 'required',
                inverse_action: 'optional'
            }
        ]
    });
});
```

## Dependency Management

KrisForm allows you to define complex logic using a JSON structure.

| Property | Description |
| :--- | :--- |
| `source` | The `name` attribute of the field to watch. |
| `condition` | A secure string expression to evaluate (e.g., `value > 10`, `value === 'yes'`). |
| `target` | The `name` (or selector) of the field(s) to modify. |
| `action` | What to do if condition is **True**. |
| `inverse_action` | (Optional) What to do if condition is **False**. |

**Supported Actions:**
*   `show` / `hide`
*   `enable` / `disable`
*   `required` / `optional`
*   `set_value:value`
*   `set_computed_value:expression`
*   `check` / `uncheck`
*   `clear`

### Expression Syntax

Used in `condition` (boolean logic) and `set_computed_value` (math).

*   **Variables**: `value` (current source), `fields.FieldName` (other fields).
*   **Logic**: `===`, `!==`, `>`, `<`, `&&`, `||`.
*   **Math**: `+`, `-`, `*`, `/`, `max(a, b...)`, `min(a, b...)`.

**Example (Computed Field):**
```javascript
{
    source: "items_count",
    condition: "true",
    action: "set_computed_value:fields.price * fields.items_count",
    target: "total_cost"
}
```

## Validation Rules

KrisForm comes with a massive list of built-in validators. You can chain them using commas: `data-validator="required, email, min:5"`.

### Basic & Logic

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `required` | - | Field must not be empty. |
| `required_with` | `field_name` | Required only if `field_name` is present. |
| `required_without` | `field_name` | Required only if `field_name` is empty. |
| `boolean` | - | Value must be true/false/1/0. |

### Numeric & Range

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `numeric` | - | Must contain only digits. |
| `number` | - | Must be a valid number (integer or float). |
| `min` | `val` | Number: `>= val`. String: `length >= val`. |
| `max` | `val` | Number: `<= val`. String: `length <= val`. |
| `lt` | `val` | Less than `val`. |
| `gt` | `val` | Greater than `val`. |
| `lte` | `val` | Less than or equal to `val`. |
| `gte` | `val` | Greater than or equal to `val`. |
| `len` | `val` | Exact string length. |

### Cross-Field Comparison
*Compares current field against another field's value.*

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `eqfield` | `field_name` | Must equal the value of target field. |
| `nefield` | `field_name` | Must NOT equal the value of target field. |
| `gtfield` | `field_name` | Must be greater than target field. |
| `gtefield` | `field_name` | Must be greater/equal to target field. |
| `ltfield` | `field_name` | Must be less than target field. |
| `ltefield` | `field_name` | Must be less/equal to target field. |

### Strings & Content

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `alpha` | - | Alphabetic characters only. |
| `alphanum` | - | Alphanumeric characters only. |
| `lowercase` | - | Must be lowercase. |
| `uppercase` | - | Must be uppercase. |
| `contains` | `text` | Must contain specific substring. |
| `notcontains` | `text` | Must NOT contain substring. |
| `startswith` | `text` | Must start with text. |
| `endswith` | `text` | Must end with text. |
| `oneof` | `a,b,c` | Must be one of the listed values. |
| `neof` | `a,b,c` | Must NOT be one of the listed values. |
| `min_alpha` | `count` | Minimum count of alphabetic chars. |
| `min_lower` | `count` | Minimum count of lowercase chars. |
| `min_upper` | `count` | Minimum count of uppercase chars. |
| `min_digit` | `count` | Minimum count of digits. |
| `min_symbol` | `count` | Minimum count of special symbols. |

### Network & Internet

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `email` | - | Valid email address. |
| `url` | - | Valid URL. |
| `ip` | - | Valid IPv4 or IPv6. |
| `ipv4` | - | Valid IPv4. |
| `ipv6` | - | Valid IPv6. |
| `cidr` | - | Valid CIDR notation. |
| `mac` | - | MAC Address. |
| `hostname` | - | Valid hostname (RFC 1123). |
| `tcp_addr` | - | TCP Address (IP:Port). |

### Financial & Identity

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `credit_card` | - | Valid Credit Card (Luhn algorithm). |
| `bic` | - | BIC/SWIFT code. |
| `btc_addr` | - | Bitcoin Address. |
| `eth_addr` | - | Ethereum Address. |
| `ssn` | - | Social Security Number (US format). |
| `uuid` | - | Valid UUID. |
| `uuid4` | - | Valid UUID v4. |

### Date & Time

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `datetime` | `layout` | Valid date. Optional layout uses **Go syntax** (e.g. `2006-01-02`). |
| `timezone` | - | Valid IANA Timezone. |

### Colors

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `hexcolor` | - | Hex color (`#RRGGBB` or `#RGB`). |
| `rgb` | - | `rgb(...)` string. |
| `rgba` | - | `rgba(...)` string. |
| `hsl` | - | `hsl(...)` string. |

### Files

| Rule | Parameter | Description |
| :--- | :--- | :--- |
| `ext` | `jpg;png` | File extension must match list (semicolon separated). |
| `image` | - | Alias for common image extensions. |

## Customizing Messages

You can set error messages globally via the `KrisFormTranslateMessages` object, or locally via data attributes.

**Option 1: Data Attributes**
```html
<input name="age" data-validator="min:18" data-msg-min="You must be at least 18 years old">
```

**Option 2: Global Configuration**
```javascript
window.KrisFormTranslateMessages = {
    default: "Invalid value",
    required: "This field is mandatory",
    email: "Please enter a valid email address",
    min: "Value must be at least %s", // %s is replaced by the parameter
    confirm_save: "Are you sure you want to change this dependency?"
};
```

## License

MIT License.