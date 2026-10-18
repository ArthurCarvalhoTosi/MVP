import { PRESETS, presetSchedule } from '../presets';

const preset = (key: string) => PRESETS.find((p) => p.key === key)!;

describe('presets', () => {
  it('lists the five MVP items', () => {
    expect(PRESETS.map((p) => p.key)).toEqual([
      'oil',
      'air_filters',
      'tire_rotation',
      'brakes',
      'timing_belt',
    ]);
  });

  it('returns normal or severe intervals', () => {
    expect(presetSchedule(preset('oil'), false)).toEqual({ intervalKm: 10000, intervalMonths: 12 });
    expect(presetSchedule(preset('oil'), true)).toEqual({ intervalKm: 5000, intervalMonths: 6 });
    expect(presetSchedule(preset('brakes'), false)).toEqual({
      intervalKm: 20000,
      intervalMonths: null,
    });
    expect(presetSchedule(preset('brakes'), true)).toEqual({
      intervalKm: 10000,
      intervalMonths: null,
    });
    expect(presetSchedule(preset('timing_belt'), true)).toEqual({
      intervalKm: 40000,
      intervalMonths: 48,
    });
  });
});
