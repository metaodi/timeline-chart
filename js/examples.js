/**
 * Built-in examples. Add more here; they show up in the "Examples" menu.
 * A value is either Mermaid code (the header decides timeline or gantt) or a
 * function returning an app state, used for Gantt plans defined by durations.
 */

/** Next Monday as YYYY-MM-DD, so example plans always lie ahead. */
export function nextMonday(from = new Date()) {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d.toISOString().slice(0, 10);
}

/** Gantt roadmap: only a start date, everything else is durations and "after". */
export function ganttExample(startDate = nextMonday()) {
  const task = (id, name, from, duration, extra = {}) => ({ id, name, type: 'task', status: '', from, duration, to: '', ...extra });
  const point = (id, name, type, from, extra = {}) => ({ id, name, type, status: '', from, duration: '', to: '', ...extra });
  return {
    mode: 'gantt',
    title: 'ART Phoenix – Roadmap',
    gantt: {
      calendar: { startDate, sprintWeeks: 2, sprintCount: 8, sprintsPerPI: 4, ipIteration: true, firstSprint: 1, firstPI: '1', sprintPrefix: 'Sprint', piPrefix: 'PI' },
      showPIs: true,
      showSprints: true,
      sections: [
        {
          name: 'Checkout',
          tasks: [
            task('api', 'Checkout API v2', 'plan', '2s', { status: 'done' }),
            task('ui', 'Checkout UI', 'prev', '2s', { status: 'active' }),
            point('rel1', 'Release 3.4', 'milestone', 'prev'),
          ],
        },
        {
          name: 'Payments',
          tasks: [
            task('spike', 'Payment provider spike', 'plan', '1w', { status: 'done' }),
            task('fraud', 'Fraud check integration', 'after:api', '5s', { status: 'crit' }),
            point('freeze', 'Code freeze 3.4', 'deadline', 's3'),
          ],
        },
        {
          name: 'Loyalty',
          tasks: [
            task('loyal', 'Loyalty points MVP', 's6', '3s'),
            task('wallet', 'Mobile wallet', 'prev', '15d'),
            point('rel2', 'Release 4.0', 'milestone', 'prev'),
          ],
        },
      ],
    },
  };
}

export const EXAMPLES = {
  'Gantt: PI roadmap (durations)': () => ganttExample(),
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
export const GANTT_EXAMPLE = 'Gantt: PI roadmap (durations)';
