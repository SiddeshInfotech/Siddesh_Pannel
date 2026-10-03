import { describe, expect, it } from 'vitest';
import { commonPrefix, splitGroups } from '../labelGroups';
import { productFilterOptionsFor } from '../productIdentity';

describe('product groups for the Product Types menu', () => {
  it('lab panel: 5 lab columns × 3 OS rows, All/Unresolved kept separate', () => {
    const { ungrouped, groups } = splitGroups(productFilterOptionsFor('lab'));
    expect(ungrouped.map((o) => o.value)).toEqual(['all', 'unresolved']);
    expect(groups).toHaveLength(5);
    for (const g of groups) expect(g.items.map((i) => i.short)).toEqual(['Android', 'Windows', 'Linux']);
    expect(groups.map((g) => g.title)).toEqual([
      'STEM Starter Lab',
      'Robotics & Drone Lab',
      'IoT & Robotics Lab',
      'AI & Future Tech Lab',
      'ThinkSphere 360 Composite Skill Lab',
    ]);
  });

  it('LMS panel: School and Lab columns', () => {
    const { groups } = splitGroups(productFilterOptionsFor('lms'));
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([['LMS School', 2], ['LMS Lab', 3]]);
  });

  it('never strips a whole label (a single item, or labels that differ from the first word)', () => {
    expect(commonPrefix(['Only One'])).toBe('');
    expect(commonPrefix(['Alpha X', 'Beta X'])).toBe('');
    expect(commonPrefix(['Lab', 'Lab Pro'])).toBe('');
  });
});
