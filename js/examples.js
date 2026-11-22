/** Built-in example timelines. Add more here; they show up in the "Examples" menu. */
export const EXAMPLES = {
  'PI plan (SAFe, sprints per PI)': `timeline
  title ART Phoenix – PI 2026.1
  section PI 2026.1 <br> 5 Jan – 13 Mar
    Sprint 1 <br> 5 Jan – 16 Jan : Checkout API v2 : Payment provider spike
    Sprint 2 <br> 19 Jan – 30 Jan : Checkout UI : Feature toggle rollout
    Sprint 3 <br> 2 Feb – 13 Feb : Fraud check integration : ⏰ Code freeze 3.4
    Sprint 4 <br> 16 Feb – 27 Feb : 🚀 Release 3.4 : 🏁 System demo
    IP Iteration <br> 2 Mar – 13 Mar : Inspect & Adapt : 🏁 PI Planning 2026.2
  section PI 2026.2 <br> 16 Mar – 22 May
    Sprint 5 <br> 16 Mar – 27 Mar : Loyalty points MVP
    Sprint 6 <br> 30 Mar – 10 Apr : Mobile wallet : ⚠️ Depends on Bank API
`,
  'Release train (milestones)': `timeline
  title Release Train 2026
  section Q1
    Jan : 🏁 PI Planning : 🚀 Release 3.3
    Feb : 🚀 Release 3.4
    Mar : ⏰ Code freeze : 🚀 Release 3.5 (LTS)
  section Q2
    Apr : 🏁 PI Planning : 🚀 Release 4.0 Beta
    May : 🚀 Release 4.0 GA : ⏰ Support end 3.x
    Jun : Hardening sprint
`,
  'Sprint roadmap (no sections)': `timeline
  title Team Rocket – Sprint Roadmap
  Sprint 21 : ✅ Login with passkeys : ✅ Bugfixes
  Sprint 22 : Profile page redesign
            : Analytics events
  Sprint 23 : Performance budget
  Sprint 24 : ⏰ Feature freeze : 🚀 Release 2.0
`,
  'Your sample (TD, sections)': `timeline TD
  title MermaidChart 2023 Timeline
    section 2023 Q1 <br> Release Personal Tier
      Bullet 1 : sub-point 1a : sub-point 1b
      Bullet 2 : sub-point 2a : sub-point 2b
    section 2023 Q2 <br> Release XYZ Tier
      Bullet 3 : sub-point <br> 3a : sub-point 3b
      Bullet 4 : sub-point 4a : sub-point 4b
`,
};

export const DEFAULT_EXAMPLE = 'PI plan (SAFe, sprints per PI)';
