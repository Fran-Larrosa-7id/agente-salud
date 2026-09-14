---
version: 1
slug: "app"
primary_target: "app"
related_targets: []
---

## Direction contract

THESIS: The surface treats every patient as a precise, legible clinical record-in-progress — like a lab report sheet — instead of the category default of a generic SaaS card-and-progress-bar dashboard bolted onto a friendly chat-style form; it refuses both the cold clinical extreme and the plush consumer-app extreme.

OWN-WORLD: Navy (#0B2545-range) as structural ink, teal/turquoise as the single accent that marks live/actionable state, soft mint and pale sky-blue as calm secondary fills, warm white/near-white page grounds. Hairline rules (1px, low-contrast) divide fields and sections the way a lab sheet divides result rows — never boxed cards nested in cards. Section labels run as small tracked caps (like a report's field labels). Numerals (percentages, counts, DNI, phone) are set with tabular/lining figures so columns of numbers align like instrument readings. Status is always icon + word + color together (✓ Completo, ! Revisión requerida, ○ Pendiente), never color alone. Progress reads as a labeled sequence of named phases (not just a bare percentage bar).

STORY: The patient understands, in under a minute, exactly what is being asked, why, and how much is left — and leaves feeling like a short, respectful check-in rather than paperwork. Recepción/administración scans a dense-but-airy table and instantly separates "listos" from "necesitan algo de mí," then opens one patient to see precisely what is missing and act on it.

FIRST VIEWPORT: Patient — a single-column mobile screen: institution/professional context in a quiet top block, one clear headline ("Preparemos tu consulta"), a named-phase progress rail (not just a percent bar), and one sticky primary CTA at the bottom. Institution — a desktop dashboard: four tabular StatCards with tabular-numeral counts across the top, a dense hairline-ruled patient table below with status as icon+word badges, filters as a quiet horizontal bar above the table, no decorative charts.

FORM: Assigned grounded direction index 6 of 7 (self-derived healthcare-adjacent world list: airport check-in/boarding pass journey, digital-banking KYC onboarding, insurance-card/carnet print system, pharmacy medication label, hospital wayfinding pictogram system, clinical lab-report sheet, hospital ops/command-center status board) — clinical lab-report sheet, raised against six catalog challengers (seed key b9d21627, mode operate): kept phase-named progress from the cyclorama-lighting challenger (declined for its forbidden gradient/glow material), kept dense-but-disciplined table scanning from the Japanese high-density-web challenger (declined for contradicting the brief's whitespace/luminous mandate), kept tabular/fixed-position numerals for StatCards from the nixie-tube-counter challenger (declined for its forbidden neon-glow material), kept addressable/revisitable per-section "cards" in the review screen from the HyperCard-stack challenger (declined for its monochrome/whimsical register). No challenger won or was competitive on both audience-identification and product-clarity axes against a healthcare-trust surface; all four raises above are named lines on the assigned direction.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
