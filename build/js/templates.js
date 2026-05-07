// Predefined ad templates — script + stock query suggestions
export const TEMPLATES = {
  viral: {
    label: "Viral fast-cut",
    duration: 25,
    voiceStyle: 0.4,
    musicQuery: "phonk dark gym workout intense beat",
    scriptTemplate: (appName) => `Si tu as plusieurs apps pour ce besoin, regarde bien.
${appName.toUpperCase()}.
Une seule app. Tout-en-un.
Feature 1.
Feature 2.
Feature 3.
Numéro un en France.
Sept jours gratuit. Télécharge.`,
    stockQueries: [
      "phone screen dark dramatic",
      "person using app smartphone",
      "fast technology motion",
      "modern workspace minimal",
      "athlete focused intense",
      "data analytics screen",
      "celebration success moment"
    ]
  },
  pov: {
    label: "POV cinématique",
    duration: 30,
    voiceStyle: 0.25,
    musicQuery: "cinematic dark slow build epic atmospheric tension",
    scriptTemplate: (appName) => `Cinq heures quarante-cinq. Personne ne se lève. Toi, si.

Pas pour exister. Pour devenir quelqu'un.

Une seule app. Tout suivi.

${appName.toUpperCase()}.

Feed the goat in you.`,
    stockQueries: [
      "alarm clock dark bedroom morning",
      "coffee pouring black mug",
      "person cinematic dark hood",
      "city sunrise moody",
      "athletic performance intense",
      "winning achievement moment",
      "headphones walking street athlete"
    ]
  },
  asmr: {
    label: "ASMR montage",
    duration: 15,
    voiceStyle: null,  // no voice
    musicQuery: "epic motivational drop trailer bass cinematic",
    scriptTemplate: (appName) => "",  // pure visual
    stockQueries: [
      "abstract motion graphics dark",
      "neon cyberpunk technology",
      "futuristic interface hud",
      "data visualization dynamic",
      "particles glow bokeh",
      "geometric shapes minimal",
      "logo reveal dark"
    ]
  },
  custom: {
    label: "Custom",
    duration: 25,
    voiceStyle: 0.4,
    musicQuery: "cinematic motivation epic",
    scriptTemplate: (appName) => "",
    stockQueries: []
  }
};
