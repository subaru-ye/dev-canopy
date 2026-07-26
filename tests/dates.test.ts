import assert from 'node:assert/strict'
import test from 'node:test'
import { localRangeUtc, monthRangeOf, shiftDate, weekRangeOf } from '../src/renderer/src/utils/dates.ts'

test('weekRangeOf 周一为起始,跨周边界归属正确', () => {
  // 2026-07-26 是周日,属于 07-20(周一) 起始的那一周。
  assert.deepEqual(weekRangeOf('2026-07-26'), { start: '2026-07-20', end: '2026-07-26' })
  // 次日周一即进入新的一周。
  assert.deepEqual(weekRangeOf('2026-07-27'), { start: '2026-07-27', end: '2026-08-02' })
  // 周中任意一天与周一本身都归属本周。
  assert.deepEqual(weekRangeOf('2026-07-22'), { start: '2026-07-20', end: '2026-07-26' })
  assert.deepEqual(weekRangeOf('2026-07-20'), { start: '2026-07-20', end: '2026-07-26' })
})

test('weekRangeOf 跨月与跨年的周界', () => {
  // 2026-08-01 是周六,所在周从 7 月末的周一开始。
  assert.deepEqual(weekRangeOf('2026-08-01'), { start: '2026-07-27', end: '2026-08-02' })
  // 2026-01-01 是周四,所在周从 2025-12-29(周一) 开始。
  assert.deepEqual(weekRangeOf('2026-01-01'), { start: '2025-12-29', end: '2026-01-04' })
})

test('monthRangeOf 覆盖月末与闰年二月', () => {
  assert.deepEqual(monthRangeOf('2026-07-15'), { start: '2026-07-01', end: '2026-07-31' })
  assert.deepEqual(monthRangeOf('2028-02-10'), { start: '2028-02-01', end: '2028-02-29' })
  assert.deepEqual(monthRangeOf('2026-02-28'), { start: '2026-02-01', end: '2026-02-28' })
})

test('localRangeUtc 是覆盖整个闭区间的半开区间', () => {
  const range = localRangeUtc('2026-07-20', '2026-07-26')
  // 区间起点即当地 07-20 零点,终点是当地 07-27 零点(不含)。
  assert.equal(range.startIso, new Date(2026, 6, 20).toISOString())
  assert.equal(range.endIso, new Date(2026, 6, 27).toISOString())
  // 周日 23:59:59 完成的任务落在本周区间内,周一零点的完成落在下一周。
  const sundayNight = new Date(2026, 6, 26, 23, 59, 59).toISOString()
  const mondayMidnight = new Date(2026, 6, 27, 0, 0, 0).toISOString()
  assert.ok(range.startIso <= sundayNight && sundayNight < range.endIso)
  assert.ok(mondayMidnight >= range.endIso)
  const nextWeek = localRangeUtc('2026-07-27', '2026-08-02')
  assert.ok(nextWeek.startIso <= mondayMidnight && mondayMidnight < nextWeek.endIso)
})

test('shiftDate 平移与周界导航衔接', () => {
  // 周导航按 7 天平移周一,得到相邻周完整区间。
  assert.equal(shiftDate('2026-07-20', 7), '2026-07-27')
  assert.equal(shiftDate('2026-07-20', -7), '2026-07-13')
  assert.deepEqual(weekRangeOf(shiftDate('2026-07-20', 7)), { start: '2026-07-27', end: '2026-08-02' })
})
