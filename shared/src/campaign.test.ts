import { describe, it, expect } from 'vitest';
import { CampaignArc, escalatedCounterMax } from './campaign.js';

const arc: CampaignArc = CampaignArc.parse({
  campaignId: 'c1',
  title: 'The Long Siege',
  escalationPerBeat: 1.5,
  beats: [
    { beatId: 'b1', title: 'Skirmish', archetype: 'boss', pacing: 'standard', baseCounterMax: 1000 },
    { beatId: 'b2', title: 'Assault', archetype: 'threat', pacing: 'standard', baseCounterMax: 1000 },
    { beatId: 'b3', title: 'Siege', archetype: 'structure', pacing: 'marquee', baseCounterMax: 1000 },
  ],
});

describe('campaign escalation', () => {
  it('leaves beat 0 at its base magnitude', () => {
    expect(escalatedCounterMax(arc, 0)).toBe(1000);
  });

  it('escalates each successive beat by the curve', () => {
    expect(escalatedCounterMax(arc, 1)).toBeCloseTo(1500);
    expect(escalatedCounterMax(arc, 2)).toBeCloseTo(2250);
  });

  it('escalation is strictly increasing when escalationPerBeat > 1', () => {
    const mags = arc.beats.map((_, i) => escalatedCounterMax(arc, i));
    for (let i = 1; i < mags.length; i++) expect(mags[i]!).toBeGreaterThan(mags[i - 1]!);
  });

  it('throws on an out-of-range beat index', () => {
    expect(() => escalatedCounterMax(arc, 99)).toThrow(RangeError);
  });

  it('defaults escalation to 1.25 when omitted', () => {
    const a = CampaignArc.parse({
      campaignId: 'c2',
      title: 'x',
      beats: [{ beatId: 'b', title: 't', archetype: 'boss', pacing: 'slow', baseCounterMax: 100 }],
    });
    expect(a.escalationPerBeat).toBe(1.25);
  });
});
