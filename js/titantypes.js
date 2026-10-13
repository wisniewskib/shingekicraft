// The nine shifters + a random mindless titan for titan mode.
// Ability types are implemented in titanplayer.js (PlayerTitan.useAbility).

export const TITAN_TYPES = [
  {
    id: 'attack', name: 'Szturmowiec', h: 15, speed: 7, run: 12, armor: 0,
    desc: 'Wszechstronny zabijaka. Szał przyspiesza go i poszerza ciosy.',
    look: { skin: '#c98670', hair: '#2a1a10', hairLong: true, face: 'teeth', eye: '#3fd17a', ears: true },
    lmb: 'Cios',
    abilities: {
      Q: { type: 'charge', name: 'Szarża barkiem', cd: 7, dur: 1.1 },
      E: { type: 'harden', name: 'Utwardzenie', cd: 15, dur: 5 },
      F: { type: 'rage', name: 'Szał', cd: 25, dur: 8 },
    },
  },
  {
    id: 'armored', name: 'Pancernik', h: 15, speed: 5.5, run: 9, armor: 0.5,
    desc: 'Pokryty pancerzem: kark dostaje połowę obrażeń. Jego szarża przebija mury.',
    look: { skin: '#c88f74', hair: null, face: 'stern', eye: '#f0e0a0', armor: '#e8dcc0' },
    lmb: 'Pięść',
    abilities: {
      Q: { type: 'charge', name: 'Pancerna szarża', cd: 9, dur: 1.8, breakWall: true },
      E: { type: 'harden', name: 'Pełne utwardzenie', cd: 16, dur: 8 },
      F: { type: 'stomp', name: 'Tupnięcie', cd: 8, r: 12 },
    },
  },
  {
    id: 'female', name: 'Łowczyni', h: 14, speed: 8, run: 14, armor: 0,
    desc: 'Szybka i precyzyjna. Utwardza kark kryształem i krzykiem ogłusza.',
    look: { skin: '#d9958a', hair: '#e8d28a', hairLong: true, thin: true, muscle: true, face: 'stern', eye: '#7ad0ff' },
    lmb: 'Uderzenie',
    abilities: {
      Q: { type: 'kick', name: 'Kopnięcie z obrotu', cd: 4, r: 1.6 },
      E: { type: 'harden', name: 'Kryształowy kark', cd: 8, dur: 3 },
      F: { type: 'scream', name: 'Krzyk', cd: 20, r: 40 },
    },
  },
  {
    id: 'colossal', name: 'Kolos', h: 40, speed: 3, run: 4.5, armor: 0,
    desc: 'Czterdzieści metrów mięśni. Para parzy wszystko wokół, ale wypala też jego ciało: chudnie i traci siły.',
    look: { skin: '#b0473a', hair: null, muscle: true, face: 'teeth', eye: '#f6f0e0' },
    lmb: 'Zamiatanie',
    abilities: {
      Q: { type: 'steam', name: 'Wybuch pary', cd: 14, dur: 6, r: 26, burn: 2.4 },
      E: { type: 'stomp', name: 'Trzęsienie', cd: 9, r: 24 },
      F: { type: 'kick', name: 'Kopniak w mur', cd: 16, r: 2.2, breakWall: true },
    },
  },
  {
    id: 'beast', name: 'Bestia', h: 17, speed: 5, run: 8, armor: 0,
    desc: 'Długie ręce i mocny rzut. Ciska wielkim głazem albo miażdży skałę w dłoni i sieje gradem odłamków.',
    look: { skin: '#6b5240', hair: '#4a3626', fur: true, longArms: true, face: 'stern', eye: '#e0c060', hunch: 0.25 },
    lmb: 'Plaśnięcie',
    abilities: {
      Q: { type: 'throw', mode: 'boulder', name: 'Głaz', cd: 4 },
      E: { type: 'throw', mode: 'spray', name: 'Grad odłamków', cd: 6, n: 12 },
      F: { type: 'summon', name: 'Ryk przywołania', cd: 30, n: 2, scream: { name: 'Ryk', r: 30 } },
    },
  },
  {
    id: 'cart', name: 'Juczny', h: 5, speed: 10, run: 17, armor: 0.2,
    desc: 'Mały i szybki, na czterech łapach. Działka na grzbiecie siekają zwiadowców.',
    look: { skin: '#b88a6a', hair: '#3a2a1a', quad: true, face: 'stern', eye: '#202020', saddle: true },
    lmb: 'Ugryzienie',
    abilities: {
      Q: { type: 'dash', name: 'Zryw', cd: 4 },
      E: { type: 'cannon', name: 'Działka', cd: 9, dur: 2.5 },
      F: { type: 'leap', name: 'Skok', cd: 6 },
    },
  },
  {
    id: 'jaw', name: 'Kieł', h: 5, speed: 11, run: 18, armor: 0.25,
    desc: 'Mały i wściekły. Tnie pazurami na boki, wspina się po murach i skacze jak wilk.',
    look: { skin: '#c09078', hair: '#e8e0c8', mask: true, face: 'mask', eye: '#ffe060', hunch: 0.45, claws: true },
    lmb: 'Szybkie cięcia', claws: true, climb: true,
    abilities: {
      Q: { type: 'leap', name: 'Doskok', cd: 3 },
      E: { type: 'rage', name: 'Twarde pazury', cd: 14, dur: 6 },
      F: { type: 'dash', name: 'Zryw', cd: 4 },
    },
  },
  {
    id: 'hammer', name: 'Kowal', h: 15, speed: 6, run: 10, armor: 0.15,
    desc: 'Wykuwa broń z kryształu: młot, który kruszy wszystko, albo kuszę do strzelania w zwiadowców.',
    look: { skin: '#e8d0c0', hair: '#f2f2f2', hairLong: true, thin: true, crystal: '#9fe8ff', face: 'stern', eye: '#9fe8ff' },
    lmb: 'Kryształowe ostrze',
    abilities: {
      Q: { type: 'weapon', weapon: 'hammer', name: 'Kryształowy młot', cd: 18, dur: 12 },
      E: { type: 'weapon', weapon: 'crossbow', name: 'Kryształowa kusza', cd: 18, dur: 10 },
      F: { type: 'spikes', name: 'Kryształowe kolce', cd: 12, r: 16 },
    },
  },
  {
    id: 'founding', name: 'Praojciec', h: 28, speed: 3.5, run: 5.5, armor: 0.1,
    desc: 'Najstarszy z olbrzymów. Zamraża każdego zwiadowcę w zasięgu i dowodzi innymi.',
    look: { skin: '#e6d6c8', hair: '#6a4a30', hairLong: true, thin: true, ribs: true, face: 'stern', eye: '#ffffff' },
    lmb: 'Zgniecenie',
    abilities: {
      Q: { type: 'scream', name: 'Rozkaz', cd: 18, r: 70, freeze: true },
      E: { type: 'summon', name: 'Rozkaz dla tytanów', cd: 25, n: 3 },
      F: { type: 'spikes', name: 'Kościane kolce', cd: 12, r: 22 },
    },
  },
];

export const RANDOM_TITAN = {
  id: 'random', name: 'Losowy tytan', random: true, speed: 6.5, run: 11, armor: 0,
  desc: 'Losowy bezrozumny tytan. Żadnych mocy, tylko głód.',
  lmb: 'Zamach',
  abilities: {
    Q: { type: 'charge', name: 'Szarża barkiem', cd: 7, dur: 1.1 },
    E: { type: 'harden', name: 'Utwardzenie', cd: 15, dur: 5 },
  },
};
