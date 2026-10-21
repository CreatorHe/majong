// Pure analytics mapping for the production v3 catalogue. IDs below are stable
// across wording/layout changes; unsupported entries never become statistics.
import { PATTERN_CATALOG as SOURCE_CATALOG } from '../pattern-catalog.js';

const ids = {
  mcr: {
    '清一色':'full_flush','混一色':'half_flush','断幺':'all_simples','碰碰和':'all_pungs','七对':'seven_pairs','连七对':'seven_shifted_pairs',
    '清龙':'pure_straight','三色三同顺':'mixed_triple_chow','一色三同顺':'pure_triple_chow','一色四同顺':'quadruple_chow',
    '一色三节高':'pure_shifted_pungs','一色四节高':'four_pure_shifted_pungs','平和':'all_chows','箭刻':'dragon_pung','双箭刻':'two_dragon_pungs',
    '连七对 · 车轮加赏':'seven_shifted_pairs_bonus','一色三节高 · 连山加赏':'pure_shifted_pungs_bonus',
    '大三元':'big_three_dragons','字一色':'all_honors','无字':'no_honors','缺一门':'one_voided_suit','将将胡':'all_258',
    '大四喜':'big_four_winds','绿一色':'all_green','九莲宝灯':'nine_gates','四杠':'four_kongs','十三幺':'thirteen_orphans',
    '清幺九':'all_terminals','小四喜':'little_four_winds','小三元':'little_three_dragons','四暗刻':'four_concealed_pungs','一色双龙会':'pure_terminal_chows',
    '一色四步高':'four_pure_shifted_chows','三杠':'three_kongs','混幺九':'all_terminals_and_honors','七星不靠':'greater_honors_and_knitted_tiles',
    '全双刻':'all_even_pungs','全大':'upper_tiles','全中':'middle_tiles','全小':'lower_tiles','三色双龙会':'three_suited_terminal_chows',
    '一色三步高':'pure_shifted_chows','全带五':'all_fives','三同刻':'triple_pung','三暗刻':'three_concealed_pungs','全不靠':'lesser_honors_and_knitted_tiles',
    '组合龙':'knitted_straight','大于五':'upper_four','小于五':'lower_four','三风刻':'big_three_winds','花龙':'mixed_straight','推不倒':'reversible_tiles',
    '三色三节高':'mixed_shifted_pungs','无番和':'chicken_hand','妙手回春':'last_tile_draw','海底捞月':'last_tile_claim','杠上开花':'out_with_replacement_tile',
    '抢杠和':'robbing_kong','三色三步高':'mixed_shifted_chows','五门齐':'all_types','全求人':'melded_hand','双暗杠':'two_concealed_kongs',
    '全带幺':'outside_hand','不求人':'fully_concealed_hand','双明杠':'two_melded_kongs','和绝张':'last_tile','圈风刻':'prevalent_wind',
    '门风刻':'seat_wind','门前清':'concealed_hand','四归一':'tile_hog','双同刻':'double_pung','双暗刻':'two_concealed_pungs','暗杠':'concealed_kong',
    '一般高':'pure_double_chow','喜相逢':'mixed_double_chow','连六':'short_straight','老少副':'two_terminal_chows','幺九刻':'terminal_or_wind_pung',
    '明杠':'melded_kong','边张':'edge_wait','嵌张':'closed_wait','单钓将':'single_wait','自摸':'self_drawn','花牌':'flower_tiles',
  },
  riichi: {
    '清一色':'full_flush','混一色':'half_flush','断幺九':'all_simples','对对和':'all_pungs','七对子':'seven_pairs','一气通贯':'pure_straight',
    '三色同顺':'mixed_triple_chow','一盃口':'pure_double_chow','二盃口':'twice_pure_double_chow','役牌':'dragon_pung','大三元':'big_three_dragons','字一色':'all_honors',
    '将将胡':'all_258','大车轮':'big_wheel','三连刻':'three_consecutive_pungs','平和':'pinfu','门前清自摸和':'fully_concealed_self_draw',
    '立直':'riichi','一发':'one_shot','双立直':'double_riichi','海底摸月':'last_tile_draw','河底捞鱼':'last_tile_claim','岭上开花':'after_kong','抢杠':'robbing_kong',
    '三色同刻':'triple_pung','三暗刻':'three_concealed_pungs','三杠子':'three_kongs','小三元':'little_three_dragons','混老头':'all_terminals_and_honors',
    '混全带幺九':'mixed_outside_hand','纯全带幺九':'pure_outside_hand','国士无双':'thirteen_orphans','四暗刻':'four_concealed_pungs',
    '小四喜':'little_four_winds','大四喜':'big_four_winds','绿一色':'all_green','清老头':'all_terminals','四杠子':'four_kongs','九莲宝灯':'nine_gates',
    '天和':'heavenly_hand','地和':'earthly_hand','人和':'humanly_hand','四连刻':'four_consecutive_pungs','一色三同顺':'pure_triple_chow',
    '一色四同顺':'quadruple_chow','大竹林':'big_bamboo_forest','大数邻':'big_numbers_neighbor','大七星':'big_seven_stars','百万石':'million_stones',
    '红孔雀':'red_peacock','蓝一色':'all_blue','红一点':'one_red_dot','黑一色':'all_black','十三不搭':'thirteen_disconnected','十四不搭':'fourteen_disconnected',
  },
};
const both = ['normal', 'pairs'];
const shapeOverrides = {
  seven_pairs:['pairs'],seven_shifted_pairs:['pairs'],big_wheel:['pairs'],big_bamboo_forest:['pairs'],big_numbers_neighbor:['pairs'],big_seven_stars:['pairs'],seven_shifted_pairs_bonus:['pairs'],
  thirteen_orphans:['orphans'],knitted_straight:['knitted','unconnected'],greater_honors_and_knitted_tiles:['unconnected'],lesser_honors_and_knitted_tiles:['unconnected'],
};
const compositionShapes = new Set(['full_flush','half_flush','all_simples','all_honors','all_green','all_terminals','all_terminals_and_honors','upper_tiles','middle_tiles','lower_tiles','upper_four','lower_four','reversible_tiles','tile_hog','one_voided_suit','no_honors','all_types','all_258']);
const knittedCompatible = new Set(['all_chows','dragon_pung','terminal_or_wind_pung','no_honors','tile_hog','all_types']);
function routesFor(mode, suffix) {
  // Riichi seven pairs needs seven distinct faces; green/terminal sets have six.
  if (mode === 'riichi' && ['all_green', 'all_terminals'].includes(suffix)) return ['normal'];
  const shapes = shapeOverrides[suffix] ?? (compositionShapes.has(suffix) ? [...both] : ['normal']);
  return mode === 'mcr' && knittedCompatible.has(suffix) ? [...new Set([...shapes, 'knitted'])] : shapes;
}
const parentName = name => name.split(' · ')[0].replace(/\s*[×x]\d+$/u, '');
const mappedName = row => ids[row.mode]?.[row.id ?? row.name] ? row.id ?? row.name : parentName(row.id ?? row.name);
const available = Object.entries(SOURCE_CATALOG).flatMap(([mode, rows]) => rows.filter(row => ['base', 'relic'].includes(row.status)).map(row => ({ ...row, mode })));
export const V3_UNMAPPED_PATTERNS = Object.freeze(available.filter(row => !ids[row.mode]?.[mappedName(row)]).map(row => `${row.mode}:${row.id ?? row.name}`));
const converted = available.flatMap(row => {
  const suffix = ids[row.mode]?.[mappedName(row)];
  if (!suffix) return []; // Release checks require V3_UNMAPPED_PATTERNS to be empty.
  return [Object.freeze({ pattern_id:`${row.mode}.${suffix}`, mode:row.mode, name:mappedName(row), fan:row.fan,
    description:suffix === 'dragon_pung' ? '白、發、中任一刻子或杠；番型出现次数每手最多计一次' : row.condition, routes:Object.freeze(routesFor(row.mode, suffix)), kind:row.status === 'relic' ? 'unlock' : 'base',
    ...(row.relicId ? {relic_id:row.relicId} : {}), ...(row.category ? {category:row.category} : {}), ...(row.classification ? {classification:row.classification} : {}) })];
});
// White/green/red dragon source entries share one per-hand parent statistic.
export const V3_PATTERN_CATALOG = Object.freeze([...new Map(converted.map(pattern => [pattern.pattern_id, pattern])).values()]);
export const V3_SOURCE_RELIC_IDS = Object.freeze([...new Set(Object.values(SOURCE_CATALOG).flatMap(rows => rows.map(row => row.relicId).filter(value => typeof value === 'string')))]);
