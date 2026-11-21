/*
 * Agralytic AI — Shared Plant-Pathology Knowledge Base
 * Used by BOTH the browser (window.AgraKB) and the Node backend (require()).
 *
 * Every treatment concentration below is deliberately conservative and is the
 * single source of truth for the Toxicity Calculator, the AI prescription engine
 * and the chatbot. Sources are listed per recipe so judges can verify them.
 */
(function (root, factory) {
  const kb = factory();
  if (typeof module === 'object' && module.exports) module.exports = kb;
  else root.AgraKB = kb;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PATHOGEN_TYPES = {
    fungal: { label: 'Fungus', color: '#a855f7', icon: '🍄', explain: 'Fungi are multicellular organisms that spread with microscopic spores carried by wind, water splash and tools. They grow thread-like hyphae that invade leaf tissue and steal nutrients.' },
    oomycete: { label: 'Water mould (Oomycete)', color: '#0ea5e9', icon: '💧', explain: 'Oomycetes look like fungi but are related to algae. They love free water: their swimming spores (zoospores) enter leaves through stomata during wet weather and can destroy a crop within days.' },
    bacterial: { label: 'Bacterium', color: '#f97316', icon: '🦠', explain: 'Bacteria are single cells, ~1/1000 mm long. They cannot pierce leaves, so they enter through wounds and natural openings (stomata, hydathodes) and multiply in the water between cells.' },
    viral: { label: 'Virus', color: '#ef4444', icon: '🧬', explain: 'Viruses are not alive on their own: they are genetic instructions in a protein shell. Insects such as aphids inject them while feeding. There is no cure once a plant is infected — only removal and vector control.' },
    abiotic: { label: 'Non-infectious (Abiotic)', color: '#eab308', icon: '🌡️', explain: 'Abiotic problems are caused by the environment, not by a germ: missing nutrients, too much sun, cold or water stress. They do not spread from plant to plant.' },
    none: { label: 'Healthy', color: '#22c55e', icon: '✅', explain: 'No sign of disease detected.' }
  };

  const DISEASES = [
    {
      id: 'healthy', name: 'Healthy Leaf', scientific: '—', type: 'none', emoji: '🌿',
      severityBase: 0, contagious: false, spreadSpeed: 0, rarity: 'common',
      hosts: ['All plants'],
      symptoms: ['Uniform green colour', 'No spots, powder or holes', 'Firm leaf blade'],
      spread: 'Not applicable.',
      conditions: 'Keep monitoring weekly — early detection is the best defence.',
      history: 'A healthy plant canopy converts ~1–2% of incoming sunlight into chemical energy that feeds the entire food chain.',
      impact: 'None.',
      recipes: ['compost_tea'],
      prevention: ['Water at the base in the morning', 'Leave space between plants for airflow', 'Scan leaves weekly'],
      progression: 0
    },
    {
      id: 'powdery_mildew', name: 'Powdery Mildew', scientific: 'Erysiphales (e.g. Podosphaera xanthii)', type: 'fungal', emoji: '❄️',
      severityBase: 2, contagious: true, spreadSpeed: 4, rarity: 'common',
      hosts: ['Cucumber', 'Squash', 'Chilli', 'Rose', 'Mango', 'Grape'],
      symptoms: ['White–grey flour-like powder on leaf surface', 'Patches merge and cover the leaf', 'Leaves yellow, curl and dry'],
      spread: 'Wind-blown conidia. Unlike most fungi it does NOT need wet leaves — warm days with humid nights are ideal.',
      conditions: '20–30 °C, relative humidity > 70% at night, shade and crowded plants.',
      history: 'Grape powdery mildew reached Europe in 1845 and destroyed up to 80% of French wine production by 1854, leading to the first large-scale use of sulfur fungicides.',
      impact: 'Reduces photosynthesis; yield losses of 20–40% in cucurbits.',
      recipes: ['milk_spray', 'bicarbonate_spray', 'neem_emulsion'],
      prevention: ['Prune for airflow', 'Avoid excess nitrogen fertilizer', 'Plant in full sun'],
      progression: 0.9
    },
    {
      id: 'early_blight', name: 'Early Blight', scientific: 'Alternaria solani', type: 'fungal', emoji: '🎯',
      severityBase: 3, contagious: true, spreadSpeed: 3, rarity: 'common',
      hosts: ['Tomato', 'Potato', 'Eggplant'],
      symptoms: ['Brown spots with concentric "target" rings', 'Yellow halo around spots', 'Starts on oldest, lowest leaves'],
      spread: 'Spores splash from soil to lower leaves during rain or overhead watering; survives on plant debris.',
      conditions: '24–29 °C with alternating wet and dry periods.',
      history: 'Described in 1882; still one of the most damaging tomato diseases in the tropics, often managed by weekly synthetic fungicide sprays.',
      impact: 'Defoliation exposes fruit to sunscald; 30–80% yield loss if untreated.',
      recipes: ['bicarbonate_spray', 'garlic_extract', 'neem_emulsion', 'sanitation_protocol'],
      prevention: ['Mulch soil to stop splash', 'Remove lowest leaves touching soil', 'Rotate crops for 2–3 years'],
      progression: 0.7
    },
    {
      id: 'late_blight', name: 'Late Blight', scientific: 'Phytophthora infestans', type: 'oomycete', emoji: '🌧️',
      severityBase: 5, contagious: true, spreadSpeed: 5, rarity: 'legendary',
      hosts: ['Tomato', 'Potato'],
      symptoms: ['Large dark, water-soaked blotches', 'Grey-white fuzz on leaf underside in humid weather', 'Rapid collapse of whole leaves and stems'],
      spread: 'Sporangia travel many kilometres on wind; swimming zoospores need leaf wetness. Can destroy a field in 7–10 days.',
      conditions: '10–25 °C with > 90% humidity or rain for 10+ hours.',
      history: 'Caused the Irish Potato Famine (1845–1852): ~1 million deaths and 1 million emigrants. It shaped modern plant pathology.',
      impact: 'Total crop loss possible; highly contagious — community alert recommended.',
      recipes: ['sanitation_protocol', 'garlic_extract'],
      prevention: ['Destroy infected plants immediately (do not compost)', 'Use resistant varieties', 'Keep foliage dry'],
      progression: 1.6
    },
    {
      id: 'leaf_spot', name: 'Cercospora / Septoria Leaf Spot', scientific: 'Cercospora spp. / Septoria lycopersici', type: 'fungal', emoji: '🟤',
      severityBase: 2, contagious: true, spreadSpeed: 3, rarity: 'common',
      hosts: ['Tomato', 'Chilli', 'Spinach', 'Beans', 'Beet'],
      symptoms: ['Many small round spots (1–5 mm)', 'Grey or tan centres with dark borders', 'Leaves yellow and drop'],
      spread: 'Rain splash, contaminated hands and tools.',
      conditions: 'Warm, humid weather with frequent leaf wetness.',
      history: 'Cercospora leaf spot of sugar beet costs European farmers hundreds of millions of euros each year and has become resistant to several chemical fungicides.',
      impact: 'Gradual defoliation and weaker plants.',
      recipes: ['bicarbonate_spray', 'neem_emulsion', 'garlic_extract'],
      prevention: ['Water at the base', 'Disinfect tools', 'Remove infected leaves early'],
      progression: 0.6
    },
    {
      id: 'rust', name: 'Rust', scientific: 'Pucciniales (e.g. Puccinia spp., Hemileia vastatrix)', type: 'fungal', emoji: '🟠',
      severityBase: 3, contagious: true, spreadSpeed: 4, rarity: 'rare',
      hosts: ['Beans', 'Corn', 'Wheat', 'Coffee', 'Rose', 'Frangipani'],
      symptoms: ['Orange–brown powdery pustules', 'Pustules mostly on leaf underside', 'Yellow flecks on upper surface'],
      spread: 'Millions of wind-borne urediniospores per pustule; can cross oceans.',
      conditions: 'Dew or light rain with 15–25 °C.',
      history: 'Coffee leaf rust wiped out Ceylon’s (Sri Lanka) coffee industry in the 1870s — the island switched to tea, which is why “Ceylon tea” exists today.',
      impact: 'Premature leaf drop and severe yield loss.',
      recipes: ['neem_emulsion', 'bicarbonate_spray', 'garlic_extract'],
      prevention: ['Remove infected leaves', 'Avoid wetting leaves at night', 'Choose resistant varieties'],
      progression: 0.9
    },
    {
      id: 'bacterial_blight', name: 'Bacterial Leaf Blight', scientific: 'Xanthomonas spp. (e.g. X. oryzae pv. oryzae)', type: 'bacterial', emoji: '🦠',
      severityBase: 4, contagious: true, spreadSpeed: 4, rarity: 'rare',
      hosts: ['Rice', 'Beans', 'Cabbage', 'Chilli', 'Tomato'],
      symptoms: ['Water-soaked, yellowing streaks starting at leaf edges/tips', 'Lesions turn straw-brown', 'Bacterial ooze droplets in the morning'],
      spread: 'Rain splash, irrigation water, wind-driven rain and tools. Enters via wounds and stomata.',
      conditions: '25–34 °C, heavy rain, typhoons and high nitrogen.',
      history: 'Bacterial blight is one of the most serious rice diseases in Asia, causing up to 50% yield loss in susceptible varieties.',
      impact: 'Fungicides do NOT work on bacteria — wrong spraying is wasted money and pollution.',
      recipes: ['sanitation_protocol', 'garlic_extract'],
      prevention: ['Avoid working with wet plants', 'Sterilise tools with 70% alcohol', 'Balanced fertilizer — avoid excess nitrogen'],
      progression: 1.0
    },
    {
      id: 'mosaic_virus', name: 'Mosaic Virus', scientific: 'Tobamovirus / Cucumovirus (TMV, CMV)', type: 'viral', emoji: '🧩',
      severityBase: 4, contagious: true, spreadSpeed: 3, rarity: 'epic',
      hosts: ['Chilli', 'Tomato', 'Cucumber', 'Papaya', 'Tobacco'],
      symptoms: ['Light/dark green or yellow mosaic mottling', 'Distorted, crinkled young leaves', 'Stunted growth'],
      spread: 'Aphids and whiteflies (CMV); hands, tools and tobacco (TMV).',
      conditions: 'Any — spreads with insect vector populations.',
      history: 'Tobacco mosaic virus was the first virus ever discovered (Ivanovsky 1892, Beijerinck 1898) and the first virus to be seen under an electron microscope (1939).',
      impact: 'No cure. Infected plants are reservoirs that infect neighbours.',
      recipes: ['sanitation_protocol', 'soap_spray'],
      prevention: ['Remove and bag infected plants', 'Control aphids/whiteflies', 'Wash hands before touching plants'],
      progression: 0.5
    },
    {
      id: 'downy_mildew', name: 'Downy Mildew', scientific: 'Peronosporaceae (e.g. Pseudoperonospora cubensis)', type: 'oomycete', emoji: '🌫️',
      severityBase: 3, contagious: true, spreadSpeed: 4, rarity: 'rare',
      hosts: ['Cucumber', 'Melon', 'Basil', 'Grape', 'Lettuce'],
      symptoms: ['Yellow, angular patches bounded by veins', 'Grey–purple fuzz on leaf underside', 'Patches turn brown and papery'],
      spread: 'Wind-borne sporangia; zoospores need leaf wetness.',
      conditions: 'Cool nights, warm days, long dew periods.',
      history: 'Grape downy mildew devastated French vineyards in the 1870s and led to the accidental discovery of Bordeaux mixture (1885) — the world’s first widely used fungicide.',
      impact: 'Rapid defoliation in cucurbits.',
      recipes: ['sanitation_protocol', 'bicarbonate_spray', 'garlic_extract'],
      prevention: ['Water early so leaves dry by night', 'Improve air circulation', 'Remove infected leaves'],
      progression: 1.1
    },
    {
      id: 'anthracnose', name: 'Anthracnose', scientific: 'Colletotrichum spp.', type: 'fungal', emoji: '⚫',
      severityBase: 3, contagious: true, spreadSpeed: 3, rarity: 'rare',
      hosts: ['Chilli', 'Mango', 'Papaya', 'Beans', 'Avocado'],
      symptoms: ['Dark brown to black sunken lesions', 'Lesions may have pinkish/orange spore masses', 'Leaf tips and edges die back'],
      spread: 'Rain splash of spores; survives in seeds and debris.',
      conditions: 'Warm (25–30 °C) and wet weather.',
      history: 'Chilli anthracnose is among the most destructive pepper diseases in Indonesia and South-East Asia, causing up to 50% fruit loss.',
      impact: 'Leaf and fruit rot; strong post-harvest losses.',
      recipes: ['neem_emulsion', 'garlic_extract', 'sanitation_protocol'],
      prevention: ['Use clean seed', 'Remove debris', 'Avoid overhead irrigation'],
      progression: 0.8
    },
    {
      id: 'nutrient_deficiency', name: 'Nutrient Deficiency (Chlorosis)', scientific: 'Abiotic — N, Fe or Mg deficiency', type: 'abiotic', emoji: '🟡',
      severityBase: 1, contagious: false, spreadSpeed: 0, rarity: 'common',
      hosts: ['All plants'],
      symptoms: ['Even yellowing of leaf blade', 'Veins may stay green (iron/magnesium)', 'Older leaves first (nitrogen) or young leaves first (iron)'],
      spread: 'Does not spread between plants.',
      conditions: 'Poor or leached soil, wrong pH, waterlogging.',
      history: 'Justus von Liebig’s "Law of the Minimum" (1840s) showed that growth is limited by the scarcest nutrient — the basis of modern fertilization.',
      impact: 'Slower growth; often mistaken for disease and wrongly sprayed with pesticides.',
      recipes: ['rabbit_urine_ferment', 'eggshell_banana_tea', 'compost_tea'],
      prevention: ['Add compost twice a year', 'Check drainage', 'Do not spray fungicides — this is not a germ!'],
      progression: 0.2
    }
  ];

  /*
   * Recipes. `active` = the ingredient that controls safety.
   * safeMin / recommended / max are expressed per litre of final spray.
   * pesticideEquivalentMl = typical synthetic concentrate replaced per litre of spray
   * (most fungicide/insecticide labels: 1–3 ml/L → we use a conservative 2).
   */
  const RECIPES = [
    {
      id: 'milk_spray', name: 'Milk Anti-Mildew Spray', emoji: '🥛', kind: 'spray', evidence: 'moderate',
      targets: ['powdery_mildew'],
      summary: 'Milk proteins and salts create free radicals in sunlight that damage mildew; also feeds beneficial microbes.',
      ingredients: [
        { key: 'milk', name: 'Fresh or UHT milk (any fat level)', perLitre: 300, unit: 'ml', kitchen: true },
        { key: 'water', name: 'Clean water', perLitre: 700, unit: 'ml', kitchen: true }
      ],
      active: { key: 'milk', label: 'Milk', unit: 'ml/L', min: 100, recommended: 300, max: 400, burn: 600 },
      steps: [
        'Wash hands and a clean spray bottle (no previous chemical residue).',
        'Measure milk and water in the ratio 3 : 7.',
        'Mix gently — do not shake into foam.',
        'Test on 2–3 leaves; wait 24 hours for any damage.',
        'Spray both sides of leaves in the morning sun, until just wet (not dripping).',
        'Repeat every 7 days for 3–4 weeks. Make fresh each time.'
      ],
      safety: ['Above 400 ml/L (40%) can leave smelly residue and grow other moulds.', 'Use within 2 hours of mixing.'],
      schedule: { everyDays: 7, times: 4, timeOfDay: 'morning' },
      sources: ['Bettiol W. (1999) Crop Protection 18:489–492 — milk vs. zucchini powdery mildew'],
      pesticideEquivalentMl: 2
    },
    {
      id: 'bicarbonate_spray', name: 'Baking Soda Shield', emoji: '🧂', kind: 'spray', evidence: 'moderate',
      targets: ['powdery_mildew', 'early_blight', 'leaf_spot', 'rust', 'downy_mildew'],
      summary: 'Bicarbonate raises the pH of the leaf surface, which stops fungal spores from germinating.',
      ingredients: [
        { key: 'soda', name: 'Baking soda (sodium bicarbonate)', perLitre: 5, unit: 'g', kitchen: true },
        { key: 'soap', name: 'Mild liquid soap (no degreaser/bleach)', perLitre: 2.5, unit: 'ml', kitchen: true },
        { key: 'oil', name: 'Vegetable cooking oil', perLitre: 5, unit: 'ml', kitchen: true },
        { key: 'water', name: 'Clean water', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'soda', label: 'Baking soda', unit: 'g/L', min: 3, recommended: 5, max: 10, burn: 15, toPercent: (v) => v / 10 },
      steps: [
        'Dissolve the baking soda completely in a little warm water.',
        'Add the oil and soap (they help the spray stick to waxy leaves).',
        'Top up with water to the final volume and shake well.',
        'Test on a few leaves first and wait 24 hours.',
        'Spray in the early morning or late afternoon — never in midday sun.',
        'Repeat every 7 days; do not exceed 4 applications in a row (sodium can build up in soil).'
      ],
      safety: ['More than 10 g/L burns leaves (brown edges).', 'Sodium accumulates in soil — alternate with another recipe.'],
      schedule: { everyDays: 7, times: 4, timeOfDay: 'early morning' },
      sources: ['Ziv & Zitter (1992) Plant Disease 76:513–517 — bicarbonate + oil vs. powdery mildew', 'University of Minnesota Extension, Powdery mildew'],
      pesticideEquivalentMl: 2
    },
    {
      id: 'neem_emulsion', name: 'Neem Oil Emulsion', emoji: '🌳', kind: 'spray', evidence: 'moderate',
      targets: ['powdery_mildew', 'rust', 'leaf_spot', 'early_blight', 'anthracnose'],
      summary: 'Cold-pressed neem oil smothers spores and disrupts insect feeding & growth (azadirachtin).',
      ingredients: [
        { key: 'neem', name: 'Cold-pressed neem oil', perLitre: 5, unit: 'ml', kitchen: false },
        { key: 'soap', name: 'Mild liquid soap (emulsifier)', perLitre: 2, unit: 'ml', kitchen: true },
        { key: 'water', name: 'Lukewarm water', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'neem', label: 'Neem oil', unit: 'ml/L', min: 3, recommended: 5, max: 10, burn: 20, toPercent: (v) => v / 10 },
      steps: [
        'Warm the water slightly (≈ 30 °C) so the oil mixes.',
        'Mix soap with the neem oil first — this makes an emulsion.',
        'Slowly pour into the water while stirring.',
        'Test on a few leaves and wait 24 hours.',
        'Spray at dusk (protects bees and avoids leaf burn). Shake the bottle often.',
        'Repeat every 7–10 days.'
      ],
      safety: ['Spray at dusk — neem can harm bees if sprayed on flowers in daylight.', 'Do not spray stressed/wilting plants or above 32 °C.'],
      schedule: { everyDays: 7, times: 4, timeOfDay: 'dusk' },
      sources: ['Schmutterer H. (1990) Annual Review of Entomology 35:271–297 — neem properties'],
      pesticideEquivalentMl: 2
    },
    {
      id: 'garlic_extract', name: 'Garlic Allicin Extract', emoji: '🧄', kind: 'spray', evidence: 'limited',
      targets: ['early_blight', 'leaf_spot', 'rust', 'bacterial_blight', 'late_blight', 'downy_mildew', 'anthracnose'],
      summary: 'Crushed garlic releases allicin, which inhibits many fungi and bacteria. Works best as a preventive.',
      ingredients: [
        { key: 'garlic', name: 'Garlic cloves (peeled, crushed)', perLitre: 20, unit: 'g', kitchen: true },
        { key: 'soap', name: 'Mild liquid soap', perLitre: 2, unit: 'ml', kitchen: true },
        { key: 'water', name: 'Clean water', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'garlic', label: 'Garlic', unit: 'g/L', min: 10, recommended: 20, max: 50, burn: 80, toPercent: (v) => v / 10 },
      steps: [
        'Crush or blend the garlic and wait 10 minutes (allicin forms after crushing).',
        'Soak in the water for 12–24 hours in a closed jar.',
        'Strain through a cloth so the sprayer does not clog.',
        'Add the soap and mix gently.',
        'Test on a few leaves, then spray in the late afternoon.',
        'Use within 2 days; repeat every 5–7 days as prevention.'
      ],
      safety: ['Strong concentrations can damage tender seedlings.', 'Allicin degrades quickly — always prepare fresh.'],
      schedule: { everyDays: 6, times: 4, timeOfDay: 'late afternoon' },
      sources: ['Curtis H. et al. (2004) Physiological & Molecular Plant Pathology 65:79–89 — allicin vs. plant pathogens'],
      pesticideEquivalentMl: 2
    },
    {
      id: 'soap_spray', name: 'Gentle Soap Vector Control', emoji: '🫧', kind: 'spray', evidence: 'moderate',
      targets: ['mosaic_virus'],
      summary: 'Kills soft-bodied insects (aphids, whiteflies) that carry viruses. It does not cure the virus — it stops spread.',
      ingredients: [
        { key: 'soap', name: 'Pure castile or mild liquid soap', perLitre: 10, unit: 'ml', kitchen: true },
        { key: 'water', name: 'Soft or rain water', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'soap', label: 'Soap', unit: 'ml/L', min: 5, recommended: 10, max: 20, burn: 30, toPercent: (v) => v / 10 },
      steps: [
        'Choose a soap without degreaser, bleach or perfume.',
        'Mix soap into water gently.',
        'Test on a few leaves and wait 24 hours.',
        'Spray directly on insects, especially leaf undersides.',
        'Repeat every 4–5 days for 2 weeks.'
      ],
      safety: ['Only kills insects it touches — no residual effect.', 'Rinse plants after a few hours if leaves look stressed.'],
      schedule: { everyDays: 5, times: 3, timeOfDay: 'late afternoon' },
      sources: ['Cranshaw W.S., Colorado State Univ. Extension Fact Sheet 5.547 — insect control: soaps'],
      pesticideEquivalentMl: 2
    },
    {
      id: 'rabbit_urine_ferment', name: 'Fermented Rabbit-Urine Booster', emoji: '🐇', kind: 'fertilizer', evidence: 'traditional',
      targets: ['nutrient_deficiency'],
      summary: 'A traditional Indonesian bio-fertilizer rich in nitrogen and potassium; fermentation removes the ammonia smell and adds microbes.',
      ingredients: [
        { key: 'urine', name: 'Fermented rabbit urine (14 days with molasses/EM4)', perLitre: 100, unit: 'ml', kitchen: false },
        { key: 'water', name: 'Clean water', perLitre: 900, unit: 'ml', kitchen: true }
      ],
      active: { key: 'urine', label: 'Ferment dilution', unit: 'ml/L', min: 50, recommended: 100, max: 200, burn: 300, toPercent: (v) => v / 10 },
      steps: [
        'Collect urine in a clean jerrycan; add 1 tablespoon molasses or sugar per litre (and EM4 if available).',
        'Close loosely and ferment in the shade for 14 days, stirring every 2 days.',
        'Dilute 1 part ferment with 9 parts water (1 : 10).',
        'Apply to the soil around the plant, not on the leaves of edible crops near harvest.',
        'Repeat every 10–14 days.'
      ],
      safety: ['Never use undiluted — it burns roots.', 'Wash hands; stop 2 weeks before harvesting leafy vegetables.'],
      schedule: { everyDays: 12, times: 3, timeOfDay: 'morning' },
      sources: ['Indonesian Ministry of Agriculture extension materials on biourine (pupuk organik cair)'],
      pesticideEquivalentMl: 1
    },
    {
      id: 'eggshell_banana_tea', name: 'Eggshell & Banana-Peel Mineral Tea', emoji: '🍌', kind: 'fertilizer', evidence: 'limited',
      targets: ['nutrient_deficiency'],
      summary: 'Recycles kitchen waste into a mild calcium & potassium soil drench.',
      ingredients: [
        { key: 'peel', name: 'Banana peels (chopped)', perLitre: 60, unit: 'g', kitchen: true },
        { key: 'eggshell', name: 'Eggshells (rinsed, crushed into powder)', perLitre: 20, unit: 'g', kitchen: true },
        { key: 'water', name: 'Clean water', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'peel', label: 'Banana peel', unit: 'g/L', min: 30, recommended: 60, max: 120, burn: 200, toPercent: (v) => v / 10 },
      steps: [
        'Rinse and dry eggshells, then crush them into fine powder.',
        'Chop banana peels into small pieces.',
        'Soak both in water for 48 hours in a covered container.',
        'Strain and pour around the base of the plant.',
        'Bury the leftover solids in compost or soil.'
      ],
      safety: ['Do not let it sit more than 3 days (it starts to rot and smell).'],
      schedule: { everyDays: 14, times: 3, timeOfDay: 'morning' },
      sources: ['Food-waste derived fertilizers review — Sustainability (various extension sources)'],
      pesticideEquivalentMl: 1
    },
    {
      id: 'compost_tea', name: 'Aerated Compost Tea', emoji: '🍵', kind: 'fertilizer', evidence: 'limited',
      targets: ['healthy', 'nutrient_deficiency'],
      summary: 'Brews beneficial microbes that compete with pathogens on leaves and in soil.',
      ingredients: [
        { key: 'compost', name: 'Mature compost', perLitre: 50, unit: 'g', kitchen: false },
        { key: 'sugar', name: 'Molasses or brown sugar', perLitre: 5, unit: 'g', kitchen: true },
        { key: 'water', name: 'De-chlorinated water (left standing 24 h)', perLitre: 1000, unit: 'ml', kitchen: true }
      ],
      active: { key: 'compost', label: 'Compost', unit: 'g/L', min: 25, recommended: 50, max: 100, burn: 200, toPercent: (v) => v / 10 },
      steps: [
        'Put compost in a cloth bag and hang it in the water.',
        'Add molasses and bubble with an aquarium pump (or stir often) for 24–36 hours.',
        'Use within 4 hours of brewing as a soil drench or light leaf spray.'
      ],
      safety: ['Do not spray on leafy vegetables close to harvest.', 'If it smells bad (anaerobic), throw it away.'],
      schedule: { everyDays: 14, times: 3, timeOfDay: 'morning' },
      sources: ['Scheuerell & Mahaffee (2002) Compost Science & Utilization 10:313–338'],
      pesticideEquivalentMl: 1
    },
    {
      id: 'sanitation_protocol', name: 'Biosecurity Isolation Protocol', emoji: '🛡️', kind: 'protocol', evidence: 'strong',
      targets: ['late_blight', 'bacterial_blight', 'mosaic_virus', 'downy_mildew', 'anthracnose', 'early_blight'],
      summary: 'For diseases that no kitchen spray can cure, isolation is the most powerful (and free) treatment.',
      ingredients: [
        { key: 'alcohol', name: '70% alcohol (or 1 part bleach : 9 parts water) for tools', perLitre: 0, unit: '', kitchen: true },
        { key: 'bags', name: 'Plastic bags for infected material', perLitre: 0, unit: '', kitchen: true },
        { key: 'gloves', name: 'Gloves', perLitre: 0, unit: '', kitchen: true }
      ],
      active: null,
      steps: [
        'Put on gloves. Do not touch healthy plants after infected ones.',
        'Cut infected leaves (or uproot the whole plant for virus/late blight).',
        'Seal material in a plastic bag — do NOT compost it.',
        'Disinfect scissors and hands with 70% alcohol.',
        'Stop overhead watering for 7 days; water only at the base.',
        'Report the case on the Outbreak Radar so neighbours can protect their plants.'
      ],
      safety: ['Wash clothes after handling late-blight plants.', 'Children should work with an adult when using bleach.'],
      schedule: { everyDays: 3, times: 4, timeOfDay: 'any time (dry leaves)' },
      sources: ['FAO (2019) Plant health and food security — integrated pest management principles'],
      pesticideEquivalentMl: 3
    }
  ];

  const GLOSSARY = [
    { term: 'Pathogen', def: 'A germ that causes disease: fungus, bacterium, virus or water mould.' },
    { term: 'Spore', def: 'A tiny "seed" made by fungi. One leaf spot can release millions, carried by wind or water.' },
    { term: 'Hypha (plural: hyphae)', def: 'A fungal thread. Many hyphae together form the mycelium — the fungus body.' },
    { term: 'Stoma (plural: stomata)', def: 'Tiny mouths under the leaf that let air in and out. Many germs sneak in through them.' },
    { term: 'Chlorophyll', def: 'The green pigment that captures sunlight. When it is destroyed, the leaf turns yellow.' },
    { term: 'Chlorosis', def: 'Yellowing of leaf tissue because of lost chlorophyll.' },
    { term: 'Necrosis', def: 'Dead tissue — usually brown or black.' },
    { term: 'Lesion', def: 'Any damaged area on a leaf, such as a spot or blotch.' },
    { term: 'Vector', def: 'An animal (often an insect) that carries a pathogen from plant to plant.' },
    { term: 'Phytotoxicity', def: 'Damage to a plant caused by a spray that is too strong — even organic sprays!' },
    { term: 'Epidemic', def: 'When a disease spreads quickly to many plants in an area.' },
    { term: 'IPM (Integrated Pest Management)', def: 'Using prevention, monitoring and the least-toxic treatment first, chemicals only as a last resort.' },
    { term: 'Edge AI', def: 'Artificial intelligence that runs directly on your phone instead of a remote server — faster, private and works offline.' },
    { term: 'Confidence score', def: 'How sure the AI is about its answer, from 0% to 100%. Always double-check low scores.' }
  ];

  const FAQ = [
    { q: 'Does Agralytic send my photo to a server?', a: 'No. Diagnosis runs inside your browser (edge AI). Only an anonymous report — disease name and a location rounded to ~100 m — is shared for the Outbreak Radar, and only if you agree. Photos you post in the Community are re-encoded to remove all hidden metadata (EXIF/GPS) first.' },
    { q: 'How accurate is the AI?', a: 'Every result shows a confidence score. The built-in engine analyses colour, texture and lesion shapes; the Diagnostics Lab shows its live benchmark. A trained deep-learning model (MobileNetV2 on PlantVillage) can be plugged in for higher accuracy. When confidence is below 60%, the app asks you to re-scan or consult an expert.' },
    { q: 'Can organic sprays harm my plants?', a: 'Yes, if they are too strong. That is why every recipe has a Toxicity Calculator and a test-patch step. Natural does not automatically mean safe.' },
    { q: 'Why does the app say "no spray" for viruses?', a: 'Viruses live inside plant cells — no spray (chemical or organic) can cure them. The responsible action is to remove the plant and control the insects that carry the virus.' },
    { q: 'Does it work without internet?', a: 'Yes. Install it as an app (PWA). Scanning, the dictionary and recipes work offline. Reports are saved in your phone and sent automatically when you are back online.' },
    { q: 'Who receives outbreak alerts?', a: 'Only people who registered their number for an area. Numbers are encrypted (AES-256) on the server and are never shown publicly.' },
    { q: 'Is this a replacement for an agronomist?', a: 'No — it is a first responder. It catches problems early and tells you when a case is serious enough to call a professional.' }
  ];

  const TROUBLESHOOT = [
    { issue: 'Camera does not start', fix: 'Allow camera permission in the browser settings. The camera only works on https:// or localhost. Close other apps that use the camera.' },
    { issue: '"Too dark" warning', fix: 'Move to daylight or turn on the flashlight toggle. Avoid strong backlight (sun behind the leaf).' },
    { issue: '"Image is blurry"', fix: 'Wipe the lens with a soft cloth, hold the phone 15–25 cm from the leaf and tap to focus.' },
    { issue: 'Leaf not detected', fix: 'Fill most of the frame with one leaf, preferably on a plain background (paper or palm of your hand).' },
    { issue: 'Low confidence result', fix: 'Scan both sides of the leaf and several leaves. Use "Cloud second opinion" if online.' }
  ];

  function disease(id) { return DISEASES.find((d) => d.id === id) || null; }
  function recipe(id) { return RECIPES.find((r) => r.id === id) || null; }

  /* Water-pollution maths used by the Eco-Impact counter (transparent assumptions). */
  const ECO = {
    activeIngredientGPerL: 250,   // typical synthetic concentrate contains ~250 g active ingredient per litre
    drinkingLimitUgPerL: 0.1,     // EU Drinking Water Directive limit per individual pesticide (0.1 µg/L)
    litresProtected(mlConcentrate) {
      const microgram = mlConcentrate * (this.activeIngredientGPerL / 1000) * 1e6; // ml→L × g/L → g → µg
      return microgram / this.drinkingLimitUgPerL;
    }
  };

  return { PATHOGEN_TYPES, DISEASES, RECIPES, GLOSSARY, FAQ, TROUBLESHOOT, ECO, disease, recipe };
});
