'use strict';
/**
 * Starting menu + settings, loaded the first time the database is created.
 * Menu, prices and hours are taken from crmbluk.com (November 2026).
 * Change anything later in /admin → Menu and /admin → Settings.
 *
 * price   = price in pence (Medium for drinks that come in two sizes)
 * price_l = Large price in pence (only for items sold in M / L)
 * section = small heading the item is listed under
 * badge   = little label (popular items: from Google reviews + Just Eat "Highlights")
 */
const m = (id, name, category, section, price, extra = {}) => ({ id, name, category, section, price, price_l: null, description: '', emoji: '🍰', badge: null, image: null, featured: 0, ...extra });

const MENU = [
  // ---------------------------------------------------------------- Specials
  m('iced-cinnamon-crunch-latte', 'Iced Cinnamon Crunch Latte', 'specials', 'Specialty drinks', 499, { price_l: 599, emoji: '🧋', badge: 'Special' }),
  m('crumbrulee-spiced-latte', 'Crûmbrûlée Spiced Latte', 'specials', 'Specialty drinks', 349, { emoji: '☕', badge: 'Special' }),
  m('maple-cinnamon-latte', 'Maple Cinnamon Latte', 'specials', 'Specialty drinks', 349, { emoji: '🍁' }),
  m('paris-hot-chocolate', 'Paris Hot Chocolate', 'specials', 'Specialty drinks', 499, { emoji: '🍫' }),
  m('watermelon-lychee-mojito', 'Watermelon & Lychee Mojito', 'specials', 'Specialty drinks', 399, { emoji: '🍉' }),
  m('iced-biscoff-matcha', 'Iced Biscoff Matcha', 'specials', 'Specialty drinks', 599, { price_l: 699, emoji: '🍵', badge: 'Special' }),
  m('mini-egg-crunch-cake', 'Mini Egg Crunch Cake', 'specials', 'Cakes (all come with custard)', 699, { emoji: '🥚' }),
  m('sticky-toffee-pudding', 'Sticky Toffee Pudding', 'specials', 'Cakes (all come with custard)', 599, { emoji: '🍮' }),
  m('chocolate-school-cake', 'Chocolate School Cake', 'specials', 'Cakes (all come with custard)', 449, { emoji: '🎂' }),
  m('red-velvet-cake', 'Red Velvet Cake', 'specials', 'Cakes (all come with custard)', 449, { emoji: '❤️' }),

  // ---------------------------------------------------------------- Crumbles
  m('apple-crumble', 'Classic Cinnamon Apple Crumble with Custard', 'crumble', 'Crumbles (our standard size is a LARGE!)', 699,
    { description: 'Sweet cinnamon apple, buttery shortbread crumble, Madagascan vanilla custard.', emoji: '🍎', badge: 'Most loved', image: '/img/crumble.jpg', featured: 1 }),
  m('crumble-custard', 'Crumble & Custard', 'crumble', 'Crumbles (our standard size is a LARGE!)', 499,
    { description: 'Our classic crumble served with Madagascan vanilla custard. Make it Crûmbrûlée (+29p)!', emoji: '🥧', badge: 'Signature', image: '/img/cups-custard.jpg', featured: 1 }),
  m('mixed-berry-crumble', 'Mixed Berry Crumble & Custard', 'crumble', 'Crumbles (our standard size is a LARGE!)', 699,
    { description: 'A vibrant mix of berries beneath our buttery shortbread crumble, served with Madagascan vanilla custard.', emoji: '🫐' }),
  m('pot-of-crumble', 'Pot of Crumble', 'crumble', 'Extras', 199, { emoji: '🥣' }),
  m('pot-of-custard', 'Pot of Custard', 'crumble', 'Extras', 199, { emoji: '🍯' }),

  // ---------------------------------------------------------------- Cake & custard
  m('school-cake', 'Pink or White School Cake', 'cake', 'Cake & custard (with custard or a scoop of vanilla ice cream)', 449,
    { description: 'Light vanilla sponge topped with pink or white icing and sprinkles.', emoji: '🎂', badge: 'Popular', featured: 1 }),
  m('jam-coconut-cake', 'Jam Coconut Cake', 'cake', 'Cake & custard (with custard or a scoop of vanilla ice cream)', 449,
    { description: 'Soft vanilla sponge with a layer of jam topped with coconut.', emoji: '🥥', badge: 'Popular' }),
  m('bruce-cake', 'The Bruce Cake', 'cake', 'Cake & custard (with custard or a scoop of vanilla ice cream)', 599,
    { description: 'The infamous chocolatey, fudgy, gooey triple-layer cake from Matilda.', emoji: '🍫', badge: 'Popular', featured: 1 }),
  m('danish-dream-cake', 'Danish Dream Cake', 'cake', 'Cake & custard (with custard or a scoop of vanilla ice cream)', 449,
    { description: 'A Danish classic: light vanilla sponge topped with caramelised coconut. Comes with fresh double cream (recommended)!', emoji: '🍰' }),
  m('caramel-tart', 'Caramel Tart', 'cake', 'Cake & custard (with custard or a scoop of vanilla ice cream)', 449,
    { description: 'Buttery shortcrust base topped with smooth caramel and chocolate sprinkles.', emoji: '🥧' }),

  // ---------------------------------------------------------------- Shakes & mojitos
  m('shake-ferrero', 'Ferrero Rocher Thick Milkshake', 'shakes', 'Thick milkshakes', 649, { emoji: '🥤' }),
  m('shake-oreo', 'Oreo Thick Milkshake', 'shakes', 'Thick milkshakes', 649, { emoji: '🥤', badge: 'Popular', featured: 1 }),
  m('shake-biscoff', 'Biscoff Thick Milkshake', 'shakes', 'Thick milkshakes', 649, { emoji: '🥤' }),
  m('shake-bueno', 'Bueno Thick Milkshake', 'shakes', 'Thick milkshakes', 649, { emoji: '🥤' }),
  m('mojito-strawberry', 'Strawberry Mojito', 'shakes', 'Mojitos', 399, { emoji: '🍓' }),
  m('mojito-passion-fruit', 'Passion Fruit Mojito', 'shakes', 'Mojitos', 399, { emoji: '🥭' }),
  m('mojito-lime-mint', 'Classic Lime & Mint Mojito', 'shakes', 'Mojitos', 399, { emoji: '🍋' }),
  m('mojito-cherry', 'Cherry Mojito', 'shakes', 'Mojitos', 399, { emoji: '🍒' }),
  m('mojito-pre-workout', 'Pre Workout Mojito', 'shakes', 'Mojitos', 499, { description: '⚠️ High caffeine. Handle with care.', emoji: '⚡' }),
  m('mojito-dirty-redbull', 'Dirty Redbull Mojito', 'shakes', 'Mojitos', 499, { emoji: '🥫' }),

  // ---------------------------------------------------------------- Coffee & drinks
  m('latte', 'Latte', 'drinks', 'Hot drinks', 249, { emoji: '☕' }),
  m('flat-white', 'Flat White', 'drinks', 'Hot drinks', 249, { emoji: '☕' }),
  m('cappuccino', 'Cappuccino', 'drinks', 'Hot drinks', 279, { emoji: '☕' }),
  m('mocha', 'Mocha', 'drinks', 'Hot drinks', 299, { emoji: '☕' }),
  m('americano', 'Americano', 'drinks', 'Hot drinks', 199, { emoji: '☕' }),
  m('espresso', 'Espresso', 'drinks', 'Hot drinks', 149, { emoji: '☕' }),
  m('babyccino', 'Babyccino', 'drinks', 'Hot drinks', 169, { emoji: '🍼' }),
  m('signature-hot-chocolate', 'Signature Hot Chocolate', 'drinks', 'Hot drinks', 299, { emoji: '🍫' }),
  m('iced-caramel-frappe', 'Iced Caramel Frappe', 'drinks', 'Cold drinks', 499, { price_l: 599, emoji: '🧋' }),
  m('iced-chocolate-frappe', 'Iced Chocolate Frappe', 'drinks', 'Cold drinks', 499, { price_l: 599, emoji: '🧋' }),
  m('iced-latte', 'Iced Latte', 'drinks', 'Cold drinks', 399, { price_l: 499, emoji: '🧊' }),
  m('iced-mocha', 'Iced Mocha', 'drinks', 'Cold drinks', 399, { price_l: 499, emoji: '🧊' }),
  m('saudi-coffee', 'Traditional Saudi Coffee', 'drinks', 'The CRMBL specialties: hot', 249, { description: 'Comes with 2 dates.', emoji: '☕' }),
  m('white-hot-chocolate', 'White Hot Chocolate', 'drinks', 'The CRMBL specialties: hot', 349, { emoji: '🤍' }),
  m('signature-chai', 'CRMBL Signature Chai', 'drinks', 'The CRMBL specialties: hot', 249, { description: 'Comes with 2 sugar almonds.', emoji: '🫖' }),
  m('crumbrulee-latte', 'Crûmbrûlee Latte', 'drinks', 'The CRMBL specialties: hot', 329, { emoji: '🔥' }),
  m('iced-spanish-latte', 'Iced Spanish Latte', 'drinks', 'The CRMBL specialties: cold', 499, { price_l: 599, emoji: '🧋' }),
  m('iced-vietnamese-latte', 'Iced Crûmbrûlee Vietnamese Latte', 'drinks', 'The CRMBL specialties: cold', 549,
    { price_l: 649, emoji: '🧋', badge: 'Fan fave', image: '/img/coffee.jpg', featured: 1 }),
  m('affogato', 'Affogato', 'drinks', 'The CRMBL specialties: cold', 499, { price_l: 599, emoji: '🍨' }),
  m('iced-classic-matcha', 'Iced Classic Matcha', 'drinks', 'The CRMBL specialties: cold', 549,
    { price_l: 649, emoji: '🍵', badge: 'Fan fave', image: '/img/matcha.jpg', featured: 1 }),
  m('custom-matcha', 'Customise Your Matcha', 'drinks', 'The CRMBL specialties: cold', 599,
    { price_l: 699, description: 'Flavours: Strawberry, Raspberry, Coconut, Blueberry, Passion Fruit, Mango, Cherry, Vanilla, Banana. Milk: Normal, Oat, Coconut, Soy, Almond. Tell us your choice in the order notes.', emoji: '🍵' }),
].map((x, i) => ({ available: 1, sort: i, ...x }));

const SETTINGS = {
  open: '15:00',            // crmbluk.com: open daily 3pm – 11pm
  close: '23:00',
  closedDays: [],           // 0 = Sunday … 6 = Saturday
  orderingEnabled: true,
  collectionEnabled: true,
  deliveryEnabled: false,   // delivery is through Uber Eats and Just Eat
  deliveryFee: 0,
  minDelivery: 0,
  deliveryPostcodes: [],
  prepMinutes: 20,
  allowPreorderWhenClosed: true,
};

module.exports = { MENU, SETTINGS };
