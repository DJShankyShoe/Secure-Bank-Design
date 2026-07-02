# SecureBank - Frontend UI

A premium, secure retail internet banking portal. This repository contains the frontend built to interface with the SecureBank Flask backend. 

The UI is designed with a focus on layered controls, high-contrast accessible design (WCAG 2.1 AA compliant), and a seamless customer experience.

## Tech Stack
* **Framework:** React.js (v18+)
* **Build Tool:** Vite (for rapid HMR and optimized production builds)
* **Routing:** React Router DOM (v6)
* **Styling:** CSS

## Key Features
* **Multi-Factor Authentication:** Two-step login flow supporting NRIC/User ID, password, and 6-digit TOTP validation.
* **Account Recovery:** Secure password reset flows requiring TOTP confirmation.
* **Role-Based Access Control (RBAC):** Protected routing distinguishing between `customer` and `admin` views.
* **Secure Transactions:** Fund transfers and bill payments with dynamic step-up authentication (6-digit PIN required for transfers $\ge$ SGD 1,000).
* **Account Management:** Open new accounts, update contact preferences, and securely close accounts.
* **Audit & History:** Filterable, paginated transaction history and an administrative operations dashboard.

---

## 🚀 Local Development Setup

Follow these steps to run the frontend application locally on your machine.

### Prerequisites
* [Node.js](https://nodejs.org/) (Version 18 or higher recommended)
* npm (comes pre-installed with Node.js)

### 1. Install Dependencies
Navigate to the root of the frontend directory and install the required packages.
```bash
npm install
```
(Note: If you encounter Vite peer-dependency version conflicts, you can safely run npm install --legacy-peer-deps)

### 2. Development Server
Launch the Vite development server
```bash
npm run dev
```
The application will be available at http://localhost:5173. Any changes saved to the .jsx or .css files will automatically update in the browser.

---
## Project Structure
The codebase is modularized to strictly separate routing, layout, and domain-specific pages.
```
frontend/
├── src/
│   ├── components/
│   │   └── Layout.jsx          # Shared TopBar and Sidebar wrapper for authenticated routes
│   ├── pages/
│   │   ├── Accounts/           # Create.jsx, Manage.jsx
│   │   ├── Admin/              # Panel.jsx (Protected admin view)
│   │   ├── Auth/               # Login.jsx, Register.jsx, ForgotPassword.jsx, ResetPassword.jsx
│   │   ├── Dashboard/          # Overview.jsx, History.jsx
│   │   └── Transactions/       # Transfer.jsx, PayBill.jsx
│   ├── App.jsx                 # Core React Router setup & access control
│   ├── main.jsx                # React DOM mounting point
│   └── styles.css              # Global application styling
├── index.html                  # Main HTML entry point
├── package.json                # Project metadata and dependencies
└── vite.config.js              # Vite bundler configuration
```
---

## Security Implementation Notes
* **Input Validation:** Financial input fields use strict Regex (e.g., /^\d*\.?\d{0,2}$/) and inputMode="decimal" to prevent invalid data types or malformed floating-point numbers from entering the component state.
* **XSS Prevention:** React JSX inherently auto-escapes all string inputs. dangerouslySetInnerHTML is strictly prohibited across the codebase.
* **Masking:** Authenticator code inputs strip all non-numeric characters instantly to prevent injection or formatting errors.

---
