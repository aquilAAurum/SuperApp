// Builtin starter foods: common items with typical values per serving (rounded from USDA FoodData
// Central "SR Legacy"/"Foundation" entries). Shipped in the bundle so search works offline and the
// subapp needs no network (its CSP has connect-src 'none'). Own foods and recents cover the rest;
// packaged-food lookup (barcode) needs a server proxy and comes later (SA-2026-008 R2).
//
// `gentle` marks low-residue, low-fibre, unspiced choices commonly tolerated during a digestive
// flare. It is a convenience filter for the owner's own "gentle mode", not medical advice.
import type { Nutrients } from './model.ts';

export interface BuiltinFood {
  key: string;
  name: string;
  serving: string;
  n: Nutrients;
  gentle?: boolean;
  group: string;
}

// key, name, serving, kcal, protein, carbs, fat, fibre, sugar, sodium(mg), gentle
type Row = [string, string, string, number, number, number, number, number, number, number, 0 | 1];

const G: Record<string, Row[]> = {
  Breakfast: [
    ['oats', 'Oatmeal, cooked with water', '1 cup (234 g)', 166, 5.9, 28, 3.6, 4, 0.6, 9, 0],
    ['cream_of_rice', 'Cream of rice, cooked', '1 cup (244 g)', 127, 2.1, 28, 0.2, 0.2, 0, 2, 1],
    ['egg', 'Egg, large, boiled', '1 egg (50 g)', 78, 6.3, 0.6, 5.3, 0, 0.6, 62, 1],
    ['egg_scrambled', 'Eggs, scrambled', '2 eggs (122 g)', 182, 12, 2, 13, 0, 1.6, 176, 1],
    ['egg_white', 'Egg whites', '3 large (99 g)', 51, 11, 0.7, 0.2, 0, 0.7, 163, 1],
    ['greek_yogurt', 'Greek yogurt, plain, nonfat', '170 g container', 100, 17, 6, 0.7, 0, 5.5, 61, 1],
    ['yogurt', 'Yogurt, plain, whole milk', '1 cup (245 g)', 149, 8.5, 11, 8, 0, 11, 113, 1],
    ['granola', 'Granola', '1/2 cup (61 g)', 290, 8.5, 33, 15, 5, 12, 15, 0],
    ['cornflakes', 'Corn flakes', '1 cup (28 g)', 100, 2, 24, 0, 1, 3, 200, 1],
    ['bran_flakes', 'Bran flakes', '3/4 cup (29 g)', 96, 3, 24, 0.7, 5, 5, 205, 0],
    ['bagel', 'Bagel, plain', '1 medium (105 g)', 277, 11, 55, 1.4, 2.4, 5.5, 443, 1],
    ['toast_white', 'Toast, white bread', '1 slice (25 g)', 66, 2.2, 12, 0.9, 0.6, 1.4, 120, 1],
    ['toast_wheat', 'Toast, whole wheat', '1 slice (32 g)', 81, 4, 14, 1.1, 2, 1.4, 146, 0],
    ['pancake', 'Pancakes, plain', '2 x 6" (154 g)', 350, 10, 44, 15, 1.5, 9, 760, 0],
    ['waffle', 'Waffle, frozen, toasted', '1 waffle (33 g)', 100, 2.3, 16, 3, 0.7, 2, 220, 0],
    ['bacon', 'Bacon, cooked', '2 slices (16 g)', 86, 6, 0.2, 6.7, 0, 0, 304, 0],
    ['sausage_link', 'Pork sausage links', '2 links (48 g)', 155, 8.6, 0.7, 13, 0, 0.5, 365, 0],
    ['peanut_butter', 'Peanut butter', '2 tbsp (32 g)', 190, 7, 7, 16, 2, 3, 140, 0],
    ['jam', 'Jam or preserves', '1 tbsp (20 g)', 56, 0.1, 14, 0, 0.2, 10, 6, 1],
    ['honey', 'Honey', '1 tbsp (21 g)', 64, 0.1, 17, 0, 0, 17, 1, 1],
    ['butter', 'Butter', '1 tbsp (14 g)', 102, 0.1, 0, 11.5, 0, 0, 91, 1],
    ['cream_cheese', 'Cream cheese', '2 tbsp (29 g)', 99, 1.7, 1.6, 9.8, 0, 0.9, 91, 1],
  ],
  Drinks: [
    ['coffee', 'Coffee, black', '1 cup (240 ml)', 2, 0.3, 0, 0, 0, 0, 5, 0],
    ['latte', 'Latte, whole milk', '16 fl oz', 190, 10, 15, 10, 0, 15, 150, 0],
    ['tea', 'Tea, unsweetened', '1 cup (240 ml)', 2, 0, 0.7, 0, 0, 0, 7, 1],
    ['milk_whole', 'Milk, whole', '1 cup (244 g)', 149, 7.7, 12, 7.9, 0, 12, 105, 0],
    ['milk_2', 'Milk, 2%', '1 cup (244 g)', 122, 8.1, 12, 4.8, 0, 12, 115, 0],
    ['milk_skim', 'Milk, skim', '1 cup (245 g)', 83, 8.3, 12, 0.2, 0, 12, 103, 0],
    ['lactose_free_milk', 'Milk, lactose-free, 2%', '1 cup (240 ml)', 130, 8, 13, 5, 0, 12, 125, 1],
    ['almond_milk', 'Almond milk, unsweetened', '1 cup (240 ml)', 39, 1, 3.4, 2.5, 0.5, 0, 170, 1],
    ['oj', 'Orange juice', '1 cup (248 g)', 112, 1.7, 26, 0.5, 0.5, 21, 2, 0],
    ['apple_juice', 'Apple juice', '1 cup (248 g)', 114, 0.2, 28, 0.3, 0.5, 24, 10, 1],
    ['soda', 'Cola', '12 fl oz can', 140, 0, 39, 0, 0, 39, 45, 0],
    ['beer', 'Beer, regular', '12 fl oz', 153, 1.6, 13, 0, 0, 0, 14, 0],
    ['wine', 'Wine, red', '5 fl oz', 125, 0.1, 3.8, 0, 0, 0.9, 6, 0],
    ['protein_shake', 'Protein shake, whey, with water', '1 scoop (31 g)', 120, 24, 3, 1.5, 0, 1, 130, 1],
    ['sports_drink', 'Sports drink', '20 fl oz', 140, 0, 36, 0, 0, 34, 270, 1],
    ['bone_broth', 'Bone broth', '1 cup (240 ml)', 40, 9, 0, 0.5, 0, 0, 450, 1],
  ],
  Fruit: [
    ['banana', 'Banana', '1 medium (118 g)', 105, 1.3, 27, 0.4, 3.1, 14, 1, 1],
    ['apple', 'Apple', '1 medium (182 g)', 95, 0.5, 25, 0.3, 4.4, 19, 2, 0],
    ['applesauce', 'Applesauce, unsweetened', '1/2 cup (122 g)', 51, 0.2, 14, 0.1, 1.3, 11, 2, 1],
    ['orange', 'Orange', '1 medium (131 g)', 62, 1.2, 15, 0.2, 3.1, 12, 0, 0],
    ['grapes', 'Grapes', '1 cup (151 g)', 104, 1.1, 27, 0.2, 1.4, 23, 3, 0],
    ['strawberries', 'Strawberries', '1 cup (152 g)', 49, 1, 12, 0.5, 3, 7.4, 2, 0],
    ['blueberries', 'Blueberries', '1 cup (148 g)', 84, 1.1, 21, 0.5, 3.6, 15, 1, 0],
    ['cantaloupe', 'Cantaloupe', '1 cup cubes (160 g)', 54, 1.3, 13, 0.3, 1.4, 13, 26, 1],
    ['watermelon', 'Watermelon', '1 cup diced (152 g)', 46, 0.9, 12, 0.2, 0.6, 9.4, 2, 1],
    ['avocado', 'Avocado', '1/2 fruit (68 g)', 114, 1.3, 6, 10.5, 4.6, 0.2, 5, 0],
    ['peach_canned', 'Peaches, canned in juice', '1/2 cup (124 g)', 55, 0.8, 14, 0, 1.6, 12, 5, 1],
    ['raisins', 'Raisins', '1/4 cup (40 g)', 120, 1.2, 32, 0.2, 1.5, 24, 10, 0],
  ],
  Vegetables: [
    ['broccoli', 'Broccoli, steamed', '1 cup (156 g)', 55, 3.7, 11, 0.6, 5.1, 2.2, 64, 0],
    ['carrots_cooked', 'Carrots, cooked', '1/2 cup (78 g)', 27, 0.6, 6.4, 0.1, 2.3, 2.7, 45, 1],
    ['carrots_raw', 'Carrots, raw', '1 medium (61 g)', 25, 0.6, 6, 0.1, 1.7, 2.9, 42, 0],
    ['green_beans', 'Green beans, cooked', '1 cup (125 g)', 44, 2.4, 10, 0.4, 4, 2, 1, 0],
    ['spinach_raw', 'Spinach, raw', '2 cups (60 g)', 14, 1.7, 2.2, 0.2, 1.3, 0.3, 47, 0],
    ['salad', 'Mixed green salad, no dressing', '2 cups (85 g)', 15, 1.2, 2.9, 0.2, 1.8, 1, 24, 0],
    ['caesar', 'Caesar salad with dressing', '1 bowl (200 g)', 360, 8, 14, 31, 3, 3, 790, 0],
    ['dressing_ranch', 'Ranch dressing', '2 tbsp (30 g)', 129, 0.4, 1.8, 13.4, 0, 1.4, 270, 0],
    ['dressing_vin', 'Vinaigrette', '2 tbsp (30 g)', 90, 0, 3, 9, 0, 2.5, 280, 0],
    ['potato_baked', 'Potato, baked, flesh only', '1 medium (156 g)', 145, 3.1, 34, 0.2, 2.3, 2.6, 8, 1],
    ['mashed_potato', 'Mashed potatoes', '1 cup (210 g)', 237, 3.9, 35, 8.9, 3.2, 3.1, 699, 1],
    ['sweet_potato', 'Sweet potato, baked, no skin', '1 medium (114 g)', 103, 2.3, 24, 0.2, 3.8, 7.4, 41, 1],
    ['corn', 'Corn, sweet, cooked', '1 ear (103 g)', 99, 3.5, 22, 1.5, 2.5, 4.7, 1, 0],
    ['peas', 'Green peas, cooked', '1/2 cup (80 g)', 67, 4.3, 12.5, 0.2, 4.4, 4.7, 2, 0],
    ['zucchini', 'Zucchini, cooked, peeled', '1 cup (180 g)', 27, 2, 4.8, 0.6, 1.8, 3, 5, 1],
    ['cucumber', 'Cucumber, peeled', '1/2 cup (60 g)', 8, 0.4, 1.3, 0.1, 0.4, 1, 1, 1],
    ['tomato', 'Tomato', '1 medium (123 g)', 22, 1.1, 4.8, 0.2, 1.5, 3.2, 6, 0],
    ['mushrooms', 'Mushrooms, sauteed', '1/2 cup (78 g)', 28, 2.9, 3.4, 0.6, 1.7, 1.8, 5, 0],
  ],
  'Grains & bread': [
    ['rice_white', 'Rice, white, cooked', '1 cup (158 g)', 205, 4.3, 45, 0.4, 0.6, 0.1, 2, 1],
    ['rice_brown', 'Rice, brown, cooked', '1 cup (195 g)', 218, 4.5, 46, 1.6, 3.5, 0.7, 2, 0],
    ['pasta', 'Pasta, cooked', '1 cup (140 g)', 221, 8.1, 43, 1.3, 2.5, 0.8, 1, 1],
    ['pasta_ww', 'Pasta, whole wheat, cooked', '1 cup (140 g)', 174, 7.5, 37, 0.8, 6.3, 1.1, 4, 0],
    ['quinoa', 'Quinoa, cooked', '1 cup (185 g)', 222, 8.1, 39, 3.6, 5.2, 1.6, 13, 0],
    ['bread_white', 'Bread, white', '1 slice (25 g)', 66, 2.2, 12, 0.9, 0.6, 1.4, 120, 1],
    ['bread_ww', 'Bread, whole wheat', '1 slice (32 g)', 81, 4, 14, 1.1, 2, 1.4, 146, 0],
    ['sourdough', 'Sourdough bread', '1 slice (50 g)', 135, 5.5, 26, 0.9, 1.1, 1.2, 300, 1],
    ['tortilla_flour', 'Tortilla, flour', '1 medium 8" (49 g)', 146, 3.9, 24, 3.6, 1.7, 1, 351, 1],
    ['tortilla_corn', 'Tortilla, corn', '2 x 6" (52 g)', 114, 2.9, 23, 1.5, 3.3, 0.5, 23, 0],
    ['crackers', 'Saltine crackers', '5 crackers (15 g)', 63, 1.4, 11, 1.3, 0.4, 0.2, 140, 1],
    ['pretzels', 'Pretzels', '1 oz (28 g)', 108, 2.9, 22.5, 0.8, 0.8, 0.8, 360, 1],
    ['couscous', 'Couscous, cooked', '1 cup (157 g)', 176, 6, 36, 0.3, 2.2, 0.2, 8, 1],
  ],
  'Meat, fish & protein': [
    ['chicken_breast', 'Chicken breast, roasted, skinless', '4 oz (112 g)', 185, 35, 0, 4, 0, 0, 83, 1],
    ['chicken_thigh', 'Chicken thigh, roasted, skinless', '4 oz (112 g)', 233, 28, 0, 12.5, 0, 0, 107, 1],
    ['turkey_breast', 'Turkey breast, roasted', '4 oz (112 g)', 165, 34, 0, 2.3, 0, 0, 63, 1],
    ['turkey_deli', 'Turkey, deli sliced', '2 oz (56 g)', 60, 10, 2, 1, 0, 1, 500, 1],
    ['ground_beef', 'Ground beef 85% lean, cooked', '4 oz (112 g)', 280, 29, 0, 17.5, 0, 0, 86, 0],
    ['steak', 'Sirloin steak, grilled', '4 oz (112 g)', 230, 34, 0, 9.5, 0, 0, 64, 0],
    ['pork_chop', 'Pork chop, lean, cooked', '4 oz (112 g)', 210, 33, 0, 7.6, 0, 0, 70, 0],
    ['ham', 'Ham, sliced', '2 oz (56 g)', 70, 10, 1.5, 2.5, 0, 1, 680, 0],
    ['salmon', 'Salmon, baked', '4 oz (112 g)', 233, 25, 0, 14, 0, 0, 69, 1],
    ['tuna_can', 'Tuna, canned in water', '1 can drained (142 g)', 179, 39, 0, 1.3, 0, 0, 539, 1],
    ['cod', 'Cod, baked', '4 oz (112 g)', 118, 26, 0, 1, 0, 0, 87, 1],
    ['shrimp', 'Shrimp, cooked', '4 oz (112 g)', 112, 27, 0.2, 0.3, 0, 0, 125, 1],
    ['tofu', 'Tofu, firm', '1/2 cup (126 g)', 181, 22, 3.5, 11, 2.9, 0.8, 18, 1],
    ['black_beans', 'Black beans, cooked', '1/2 cup (86 g)', 114, 7.6, 20, 0.5, 7.5, 0.3, 1, 0],
    ['lentils', 'Lentils, cooked', '1/2 cup (99 g)', 115, 9, 20, 0.4, 7.8, 1.8, 2, 0],
    ['hummus', 'Hummus', '2 tbsp (30 g)', 70, 2, 4, 5, 1, 0, 115, 0],
    ['cottage_cheese', 'Cottage cheese, 2%', '1/2 cup (113 g)', 92, 12, 5, 2.6, 0, 4.6, 348, 1],
    ['cheddar', 'Cheddar cheese', '1 oz (28 g)', 115, 6.5, 0.4, 9.5, 0, 0.1, 180, 1],
    ['mozzarella', 'Mozzarella, part skim', '1 oz (28 g)', 72, 6.9, 0.8, 4.5, 0, 0.3, 175, 1],
    ['almonds', 'Almonds', '1 oz (28 g)', 164, 6, 6.1, 14, 3.5, 1.2, 0, 0],
    ['walnuts', 'Walnuts', '1 oz (28 g)', 185, 4.3, 3.9, 18.5, 1.9, 0.7, 1, 0],
    ['protein_bar', 'Protein bar', '1 bar (60 g)', 210, 20, 22, 7, 3, 2, 180, 0],
  ],
  Meals: [
    ['pizza', 'Pizza, cheese, regular crust', '1 slice (107 g)', 285, 12, 36, 10, 2.5, 3.8, 640, 0],
    ['burger', 'Hamburger with bun', '1 burger (110 g)', 275, 13, 31, 11, 1.4, 6, 500, 0],
    ['fries', 'French fries', 'Medium (117 g)', 365, 4, 48, 17, 4.4, 0.3, 246, 0],
    ['burrito', 'Burrito, beef and bean', '1 burrito (220 g)', 520, 22, 60, 21, 8, 3, 1200, 0],
    ['tacos', 'Tacos, beef, hard shell', '2 tacos (156 g)', 340, 16, 28, 18, 4, 2, 580, 0],
    ['sandwich_turkey', 'Turkey sandwich on wheat', '1 sandwich', 320, 23, 36, 9, 4, 6, 1050, 0],
    ['grilled_cheese', 'Grilled cheese sandwich', '1 sandwich', 370, 15, 28, 22, 1, 4, 820, 1],
    ['pbj', 'Peanut butter and jelly sandwich', '1 sandwich', 380, 12, 50, 16, 4, 20, 450, 0],
    ['chicken_soup', 'Chicken noodle soup', '1 cup (248 g)', 62, 3.2, 7.3, 2.4, 0.5, 0.7, 640, 1],
    ['chili', 'Chili with beans', '1 cup (253 g)', 287, 15, 30, 14, 11, 6, 1050, 0],
    ['mac_cheese', 'Macaroni and cheese', '1 cup (200 g)', 350, 13, 42, 14, 2, 6, 780, 1],
    ['spaghetti', 'Spaghetti with marinara', '1.5 cups (375 g)', 390, 13, 72, 6, 6, 12, 760, 0],
    ['stir_fry', 'Chicken stir-fry with rice', '1 plate (400 g)', 540, 32, 70, 14, 4, 10, 1100, 0],
    ['sushi_roll', 'California roll', '8 pieces (220 g)', 290, 9, 50, 7, 4, 8, 600, 1],
    ['poke', 'Poke bowl, salmon', '1 bowl (450 g)', 600, 32, 75, 20, 5, 10, 1300, 0],
    ['rotisserie', 'Rotisserie chicken, meat and skin', '1/4 chicken (150 g)', 360, 40, 0, 22, 0, 0, 700, 0],
  ],
  Snacks: [
    ['chips', 'Potato chips', '1 oz (28 g)', 152, 1.9, 15, 9.8, 1.2, 0.1, 148, 0],
    ['popcorn', 'Popcorn, air-popped', '3 cups (24 g)', 93, 3, 19, 1.1, 3.5, 0.2, 2, 0],
    ['tortilla_chips', 'Tortilla chips', '1 oz (28 g)', 140, 2, 18, 7, 1, 0, 120, 0],
    ['salsa', 'Salsa', '2 tbsp (32 g)', 10, 0.5, 2, 0, 0.5, 1, 230, 0],
    ['dark_chocolate', 'Dark chocolate 70-85%', '1 oz (28 g)', 170, 2.2, 13, 12, 3.1, 6.8, 6, 0],
    ['cookie', 'Chocolate chip cookie', '1 medium (30 g)', 148, 1.6, 20, 7.3, 0.7, 10, 98, 0],
    ['ice_cream', 'Ice cream, vanilla', '1/2 cup (66 g)', 137, 2.3, 16, 7.3, 0.5, 14, 53, 1],
    ['frozen_yogurt', 'Frozen yogurt', '1/2 cup (72 g)', 114, 2.9, 17, 4, 0, 17, 63, 1],
    ['rice_cake', 'Rice cake, plain', '2 cakes (18 g)', 70, 1.4, 15, 0.5, 0.8, 0.2, 58, 1],
    ['string_cheese', 'String cheese', '1 stick (28 g)', 80, 7, 1, 6, 0, 0, 200, 1],
    ['jerky', 'Beef jerky', '1 oz (28 g)', 116, 9.4, 3.1, 7.3, 0.5, 2.6, 506, 0],
    ['granola_bar', 'Granola bar', '1 bar (24 g)', 100, 2, 17, 3.5, 1, 7, 70, 0],
    ['jello', 'Gelatin dessert', '1/2 cup (135 g)', 80, 1.6, 19, 0, 0, 18, 100, 1],
    ['pudding', 'Vanilla pudding cup', '1 cup (99 g)', 110, 1, 22, 2, 0, 16, 160, 1],
  ],
  'Oils & condiments': [
    ['olive_oil', 'Olive oil', '1 tbsp (14 g)', 119, 0, 0, 13.5, 0, 0, 0, 1],
    ['mayo', 'Mayonnaise', '1 tbsp (14 g)', 94, 0.1, 0.1, 10.3, 0, 0.1, 88, 0],
    ['ketchup', 'Ketchup', '1 tbsp (17 g)', 17, 0.2, 4.5, 0, 0, 3.7, 154, 0],
    ['sugar', 'Sugar', '1 tsp (4 g)', 16, 0, 4.2, 0, 0, 4.2, 0, 1],
    ['soy_sauce', 'Soy sauce', '1 tbsp (16 g)', 9, 1.3, 0.8, 0.1, 0.1, 0.1, 879, 0],
    ['maple_syrup', 'Maple syrup', '2 tbsp (40 g)', 104, 0, 27, 0, 0, 24, 5, 1],
  ],
};

export const BUILTIN_FOODS: BuiltinFood[] = Object.entries(G).flatMap(([group, rows]) =>
  rows.map(([key, name, serving, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, gentle]) => ({
    key,
    name,
    serving,
    group,
    gentle: gentle === 1 || undefined,
    n: { kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg },
  })),
);

export const BUILTIN_BY_REF = new Map(BUILTIN_FOODS.map((f) => [`b:${f.key}`, f]));
