# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Marketing/lead-generation website for **Investment Reclaim UK** — a service connecting people who lost money in investment schemes or mis-sold pensions with a panel of solicitors. It is a **static site plus one serverless function**, deployed on Vercel. There is no build step, no package.json, and no test suite — you edit HTML files directly.

All site code lives in **`site/`** (no spaces — Vercel serverless functions reject paths containing spaces).

**Run Vercel commands from the REPO ROOT, not from inside `site/`.** The Vercel project's Root Directory setting is already `site`, so running from inside it makes Vercel look for `site/site` and fail with "The provided path does not exist". Corrected 2026-08-30 after that error during the Plan 3 go-live.

## Commands

```bash
# From the repo root, NOT from site/
vercel dev      # Run locally — serves static pages AND the /api/send function
vercel          # Deploy a preview
vercel --prod --yes   # Deploy to production (aliases investmentreclaimuk.co.uk)
```

The folder is linked to the Vercel project `mrmurrayproject2026/investment-reclaim-uk` (see `.vercel/`, gitignored). There are no lint or test commands.

## Architecture: the `.dc.html` "Design Component" system

Pages are **`.dc.html` files** rendered **client-side as React** by `support.js`. This is the single most important thing to understand before editing.

- Each page is a normal HTML document that loads `support.js` and wraps its real content in an `<x-dc>...</x-dc>` block. `support.js` parses that block and hydrates it into a React tree in the browser.
- **`support.js` is GENERATED** (from a separate `dc-runtime/src/*.ts` Bun project that is **not in this repo**). Its header says "do not edit." Never hand-edit `support.js`; treat it as a vendored runtime.
- At runtime `support.js` loads **React 18.3.1 + ReactDOM + Babel standalone from unpkg CDN**. So the live site depends on a network fetch to unpkg to render at all.
- A `<helmet>...</helmet>` block inside `<x-dc>` holds `<head>` content (fonts, page `<style>`). Templates support `{{ expr }}` interpolation and an optional `<script data-dc-script>` defining `class Component extends DCLogic` for page logic/state.

### Shared components

Reusable pieces are imported with `<dc-import name="Header">`, which fetches `Header.dc.html` from the **same directory** (`COMPONENT_DIR` is `"."`). The three shared components are **`Header`**, **`Footer`**, and **`AssessmentForm`**.

> Because component names resolve to `./<Name>.dc.html`, **all `.dc.html` files must stay flat in `site/`** — do not move them into subfolders.

Pages: `index`, `claims`, `how-it-works`, `faq`, `our-panel`, `success-stories`, `blog`, `contact`, plus legal pages (`terms`, `privacy-policy`, `cookie-policy`). Header/Footer are imported into all of them; AssessmentForm is the contact form.

## The contact form → email → CRM flow

`AssessmentForm.dc.html` POSTs the form as JSON to **`/api/send`**. `api/send.js` is a Vercel serverless function that emails the submission via **Resend** (`https://api.resend.com/emails`).

**Since Plan 3 (live 2026-08-30) it also posts the enquiry to the claims CRM.** The email is still the record of truth; the CRM post is best-effort, never throws, and a failure is one log line the visitor never sees. It is skipped entirely unless BOTH `CRM_INTAKE_URL` and `CRM_INTAKE_KEY` are set — a URL without a key would post unauthenticated.

**The consent wording in `AssessmentForm.dc.html` must stay word for word identical to `INVESTMENT_CONSENT_TEXT` and `INVESTMENT_MARKETING_TEXT` in the CRM repo's `src/lib/consent.ts`**, because the CRM stores its own copy as the record of what was shown. Change one, change both, and bump the version stamp.

Operational requirements (these are why the form may "fail" in a fresh environment):
- Requires env var **`RESEND_API_KEY`** in the Vercel project (Production). Without it the endpoint returns 500 "Email service not configured".
- **`CRM_INTAKE_URL`** and **`CRM_INTAKE_KEY`** (both Production, both set 2026-08-30) send each enquiry to the CRM. Optional: the form works without them.
- Sends **from** `enquiries@investmentreclaimuk.co.uk` **to** `info@investmentreclaimuk.co.uk`. The `from` domain must be **verified in Resend** (resend.com/domains) or Resend returns a 403 "domain is not verified". For quick local testing you can temporarily change `from` to `onboarding@resend.dev`.

## Routing

`vercel.json` sets `cleanUrls: false` and rewrites `/` → `/index.dc.html`. All other pages are reached by their literal `*.dc.html` filenames (links between pages use e.g. `href="contact.dc.html"`).

## Conventions

- **Styling is inline `style="..."` on every element with hardcoded hex/px** — there is no CSS framework or stylesheet. Brand palette: navy `#0F172A`, gold `#C9A227`, light background `#F8FAFC`. Fonts: Inter (body), Spectral / Cormorant Garamond (headings). Animation/hover classes are prefixed `arp-`. Match this style when adding markup.
- `image-slot.js` is an "omelette" scaffold component (`<image-slot>`, a drag-to-fill image placeholder). It is **read-only outside the omelette editor runtime** and tagged `@ds-adherence-ignore`. It is not part of the public site's normal rendering path — leave it alone unless specifically working on image slots.
- The whole codebase is hand-written HTML; there is no transpilation you control. "Build" = deploy.
