# Employee Competencies — Node.js API

Express + Prisma REST API for managing employee performance and competencies.

## Stack
- **Node.js** + **Express** — HTTP server
- **Prisma** — ORM over PostgreSQL
- **bcryptjs** — password hashing
- **jsonwebtoken** — stateless JWT auth
- **Zod** — request validation

---

## Quick start

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, etc.
```

### 3. Set up the database
```bash
# Push schema to your PostgreSQL database
npm run db:push

# Seed the first admin user
npm run db:seed
# Credentials: admin@company.com / Admin@1234 (must change on first login)
```

### 4. Run the server
```bash
npm run dev   # development (ts-node + nodemon)
npm run build && npm start  # production
```

Server listens on `http://localhost:4000` by default.

---

## API Reference

### Auth — `/api/auth`
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/login` | Public | Returns JWT token |
| GET | `/me` | Any | Current user profile |
| POST | `/register` | Admin | Create a new user |
| POST | `/change-password` | Any | Change own password |
| POST | `/seed-admin` | Public (once) | Bootstrap first admin |

### Employees — `/api/employees`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Admin/HR/Supervisor |
| GET | `/:id` | Admin/HR/Supervisor/Self |
| PUT | `/:id` | Admin/HR |
| DELETE | `/:id` | Admin |

### Job Titles — `/api/job-titles`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Any |
| GET | `/:id` | Any |
| POST | `/` | Admin |
| PUT | `/:id` | Admin |
| DELETE | `/:id` | Admin |

### Competencies — `/api/competencies`
| Method | Path | Access |
|--------|------|--------|
| GET | `/?jobTitleId=` | Any |
| GET | `/:id` | Any |
| POST | `/` | Admin |
| PUT | `/:id` | Admin |
| DELETE | `/:id` | Admin |

### Evaluations — `/api/evaluations`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Own evaluations (Admin/HR see all) |
| GET | `/:id` | Involved parties / Admin / HR |
| POST | `/` | Any (becomes evaluator) |
| DELETE | `/:id` | Evaluator / Admin |

### Development Plans — `/api/development-plans`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Employee / Supervisor / Admin / HR |
| GET | `/:id` | Involved / Admin / HR |
| POST | `/` | Any (becomes supervisor) |
| PUT | `/:id` | Supervisor / Admin |
| DELETE | `/:id` | Supervisor / Admin |
| POST | `/:id/items` | Supervisor / Admin |
| PUT | `/:planId/items/:itemId` | Supervisor / Admin |
| DELETE | `/:planId/items/:itemId` | Supervisor / Admin |

### Quizzes — `/api/quizzes`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Own quizzes (Admin/HR see all) |
| GET | `/:id` | Any |
| POST | `/` | Any (becomes owner) |
| PUT | `/:id` | Owner / Admin |
| DELETE | `/:id` | Owner / Admin |
| POST | `/:id/questions` | Owner / Admin |
| PUT | `/:quizId/questions/:questionId` | Owner / Admin |
| DELETE | `/:quizId/questions/:questionId` | Owner / Admin |

### Quiz Assignments — `/api/quiz-assignments`
| Method | Path | Access |
|--------|------|--------|
| GET | `/` | Own assignments (Admin/HR see all) |
| GET | `/:id` | Employee / Admin / HR |
| POST | `/` | Supervisor |
| POST | `/:id/attempt` | Assigned employee |

### Reports — `/api/reports`
| Method | Path | Access |
|--------|------|--------|
| GET | `/individual/:employeeId` | Self / Supervisor / Admin / HR |
| GET | `/team/:supervisorId` | Supervisor (self) / Admin / HR |
| GET | `/org` | Admin / HR only |

---

## Authentication

All protected routes require a `Bearer` token in the `Authorization` header:
```
Authorization: Bearer <your-jwt-token>
```

Tokens are obtained from `POST /api/auth/login`.

---

## Roles
| Role | Capabilities |
|------|-------------|
| `admin` | Full access to everything |
| `hr` | Read-only access to all employees, evaluations, reports |
| `employee` | Access only to own data, assigned quizzes |

Supervisors are identified by the `supervisorId` field on each user — any user can be a supervisor of others regardless of their role.

---

## Database commands
```bash
npm run db:migrate   # run migrations (development)
npm run db:push      # push schema without migration history
npm run db:studio    # open Prisma Studio at localhost:5555
npm run db:seed      # seed first admin user
```
