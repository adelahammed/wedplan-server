# WedPlan - Server API

Backend RESTful API service powering the **WedPlan** luxury wedding planning and vendor booking platform. Built with Node.js, Express, and MongoDB, providing secure JWT authentication, role-based authorization, service listings management, booking transactions, and platform governance.

---

## Important Features
- **JWT-Based Authentication & Authorization**: Secure token generation and role-specific validation middlewares for Admins, Vendors, and Customers.
- **Role Verification**: Server-side checks on all protected API endpoints ensuring resource ownership and privilege separation.
- **Account Blocking Mechanism**: Real-time blocking and unblocking preventing restricted accounts from executing platform actions.
- **Service Listings Management**: Dynamic aggregation pipelines joining services with vendor profiles, featuring category, location, and price sorting filters.
- **Vendor Quota Enforcement**: Automatic limitation restricting Free tier vendors to a maximum of 3 active services.
- **Booking Request Processing**: Duplicate detection prevention, customer validation checks, and state transitions (Pending, Accepted, Rejected, Cancelled).
- **Administrative Intelligence**: System-wide analytical counters aggregating registered users, active packages, booking records, and platform audits.

---

## Technology Stack
- **Runtime**: Node.js
- **Framework**: Express.js 5
- **Database**: MongoDB (Official MongoDB Node.js Driver)
- **Authentication & Security**: JSON Web Token (`jsonwebtoken`), CORS, Dotenv
- **Payments Ready**: Stripe SDK

---

## Installation Instructions

1. Clone the repository:
```bash
git clone https://github.com/adelahammed/wedplan-server.git
cd wedplan-server
```

2. Install dependencies:
```bash
npm install
```

3. Configure Environment Variables:
Create a `.env` file in the root directory:
```env
PORT=5000
MONGODB_URL=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
ACCESS_TOKEN_SECRET=your_access_token_secret
```

---

## How to Run the Project Locally

Start the development server with auto-reload:
```bash
node --watch index.js
```
Or with standard node:
```bash
node index.js
```

The server will initialize on `http://localhost:5000`.

---

## Repository & Deployment Links
- **Client Repository**: [https://github.com/adelahammed/wedplan-client](https://github.com/adelahammed/wedplan-client)
- **Server Repository**: [https://github.com/adelahammed/wedplan-server](https://github.com/adelahammed/wedplan-server)
- **Live Website**: [https://wedplan-client.vercel.app](https://wedplan-client.vercel.app)
