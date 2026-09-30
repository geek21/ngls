# School Weekly Plan System
## نظام الخطة الأسبوعية للمدرسة

A bilingual (Arabic/English) web application for managing school weekly lesson plans.

**Stack:** HTML5 + Tailwind CSS + Vanilla JS + Supabase (PostgreSQL)  
**Hosting:** GitHub Pages (static)  
**No build step required.**

---

## Setup

### 1. Supabase
- Create a new project at [supabase.com](https://supabase.com)
- Open **SQL Editor** → paste and run `schema.sql`
- Copy your **Project URL** and **anon public key**

### 2. Configure
Open `js/config.js` and replace:
```js
const SUPABASE_URL     = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```

### 3. Deploy
- Push to GitHub
- Enable **GitHub Pages** → Settings → Pages → Branch: `main` → `/root`
- Your app is live at `https://yourusername.github.io/repo-name/`

---

## Database Migrations (existing projects only)

Run in order if upgrading an existing Supabase project:
```
migration_v5_subject_grade_range.sql  → adds grade range to branches
migration_v6_subsubject_days.sql      → adds days_per_week to branches
```

---

## Features
- 📚 Multi-department weekly plan entry (teacher portal)
- 🔒 bcrypt PIN authentication per department + admin
- 🔗 Smart weekly links with 30-day expiry
- 📱 Mobile-first accordion UI
- 📊 Admin dashboard with completion tracking
- 📅 Days schedule manager per branch (AL/OL)
- 🖨 Print preview + PDF export per grade
- ⬇ Excel export
- 📆 Automatic week date range (Sun → Thu)

---

## Project Structure
```
├── index.html          # App shell + HTML templates
├── css/app.css         # Custom styles
└── js/
    ├── config.js       # Supabase client + STATE + utilities
    ├── utils.js        # Init + auth + UI primitives
    ├── teacher.js      # Teacher portal
    ├── admin.js        # Admin dashboard + management
    └── export.js       # Excel + Print/PDF
```

---

© New Generation Language School — Built with ❤️
