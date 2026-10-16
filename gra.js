(() => {
  "use strict";

  // ---------- Stałe gry ----------
  const CZAS_RUNDY = 25;            // sekundy na odpowiedź
  const RUND_W_NURKOWANIU = 7;
  const METRY_ZA_PUNKT = 10;
  const BUTLE_TLENU = 3;            // tryb bez końca
  const PUNKTY_WLASNE = 60;         // za słowo uznane ręcznie
  const MIN_DLUGOSC_LITERY = 4;     // minimalna długość słowa w zadaniach literowych

  const STREFY = [
    { od: 0, nazwa: "Strefa słoneczna", stwor: "Mijasz ławice kryla i ciekawskie delfiny." },
    { od: 200, nazwa: "Strefa zmierzchu", stwor: "Wokół migoczą latarniki i kałamarnice." },
    { od: 1000, nazwa: "Strefa północy", stwor: "Z ciemności wyłania się żabnica z latarenką." },
    { od: 4000, nazwa: "Otchłań", stwor: "Obok przepływa ośmiornica dumbo." },
    { od: 6000, nazwa: "Rów oceaniczny", stwor: "Spotykasz dennika mariańskiego, najgłębiej żyjącą rybę." },
    { od: 10935, nazwa: "Głębia Challengera", stwor: "Dotykasz dna Rowu Mariańskiego. Dalej już tylko skała." },
    { od: 12000, nazwa: "Pod dnem oceanu", stwor: "Słowa tak rzadkie, że przebiłeś się przez skorupę Ziemi." },
  ];
  const ZNACZNIKI = [200, 1000, 4000, 6000, 10935];
  const MAKS_SKALI = 11000;

  const POZIOMY = [
    { nazwa: "Brak", kl: "t0", emoji: "⬛" },
    { nazwa: "Płycizna", kl: "t1", emoji: "🟦" },
    { nazwa: "Toń", kl: "t2", emoji: "🟩" },
    { nazwa: "Głębia", kl: "t3", emoji: "🟪" },
    { nazwa: "Otchłań", kl: "t4", emoji: "🟥" },
    { nazwa: "Twoje słowo", kl: "t5", emoji: "🟨" },
  ];
  const NAZWY_PACZEK = {
    "jedzenie": "Jedzenie", "zwierzęta": "Zwierzęta", "geografia": "Geografia", "natura": "Przyroda",
    "dom": "Dom i rzeczy", "ludzie": "Ludzie", "kultura": "Kultura", "różne": "Coś, co…", "litery": "Litery",
  };

  // ---------- Pamięć przeglądarki (zawsze z try/catch) ----------
  const KLUCZ = "glebina.v1";
  function wczytaj() {
    try { return JSON.parse(localStorage.getItem(KLUCZ)) || {}; } catch { return {}; }
  }
  const pamiec = Object.assign({ gry: 0, rekord: 0, lacznie: 0, seria: 0, ostatniDzien: null, dni: {}, odkryte: {}, wlasne: {} }, wczytaj());
  function zapisz() {
    try { localStorage.setItem(KLUCZ, JSON.stringify(pamiec)); } catch { /* bez pamięci też da się grać */ }
  }

  // ---------- Normalizacja i dopasowanie ----------
  const MAPA_ZNAKOW = { "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z" };
  function norm(s) {
    return String(s).toLowerCase()
      .replace(/[ąćęłńóśźż]/g, (c) => MAPA_ZNAKOW[c])
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function maleLitery(s) {
    return String(s).toLowerCase().replace(/[^a-ząćęłńóśźż]/g, "");
  }
  const KONCOWKI = ["owie", "ami", "ach", "kami", "kach", "ów", "om", "ki", "ek", "ka", "ko", "ce", "ca", "y", "i", "e", "a", "o", "u", "ę", "ą"]
    .map(norm).sort((a, b) => b.length - a.length);
  function rdzen(s) {
    const t = s.replace(/ /g, "");
    for (const k of KONCOWKI) {
      if (t.length - k.length >= 4 && t.endsWith(k)) return t.slice(0, -k.length);
    }
    return t;
  }
  function odleglosc(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let min = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur.push(v);
        if (v < min) min = v;
      }
      if (min > limit) return limit + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }
  function tolerancja(n) { return n <= 4 ? 0 : n <= 7 ? 1 : 2; }

  // ---------- Kategorie ----------
  const KATEGORIE = (window.KATEGORIE || []).map((k, i) => {
    const odp = k.w.map(([pokaz, pkt, ...warianty]) => ({ pokaz, pkt, formy: [pokaz, ...warianty].map(norm).filter(Boolean) }));
    const indeks = new Map();
    for (const o of odp) for (const f of o.formy) if (!indeks.has(f)) indeks.set(f, o);
    return { id: "k" + i, typ: "kategoria", q: k.q, paczka: k.p, odp, indeks };
  });

  // Kategoria + litera ("Owoc na literę P"): tysiące dodatkowych pytań z tych samych list.
  const MIN_ODP_KOMBINACJI = 6;
  const KOMBINACJE = [];
  for (const kat of KATEGORIE) {
    const nazwa = kat.q.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const poczatki = new Map(), konce = new Map();
    const dodaj = (m, l, o) => { if (!m.has(l)) m.set(l, []); m.get(l).push(o); };
    for (const o of kat.odp) {
      const litery = maleLitery(o.pokaz);
      if (!litery) continue;
      dodaj(poczatki, litery[0], o);
      dodaj(konce, litery[litery.length - 1], o);
    }
    const utworz = (odp, dane) => {
      if (odp.length < MIN_ODP_KOMBINACJI) return;
      const indeks = new Map();
      for (const o of odp) for (const f of o.formy) if (!indeks.has(f)) indeks.set(f, o);
      KOMBINACJE.push({ typ: "kategoria", baza: kat.q, paczka: kat.paczka, odp, indeks, ...dane });
    };
    for (const [l, odp] of poczatki) utworz(odp, {
      id: kat.id + ":" + l, litera: l,
      q: `${kat.q} na literę ${l.toUpperCase()}`,
      html: `${nazwa} na literę <span class="lit">${l.toUpperCase()}</span>`,
    });
    for (const n of [8, 10, 12]) utworz(kat.odp.filter((o) => maleLitery(o.pokaz).length >= n), {
      id: kat.id + ":d" + n, minDlugosc: n,
      q: `${kat.q}, co najmniej ${n} liter`,
      html: `${nazwa}, <span class="lit">co najmniej ${n} liter</span>`,
    });
    for (const [l, odp] of konce) utworz(odp, {
      id: kat.id + ":-" + l, koniec: l,
      q: `${kat.q} z końcówką -${l.toUpperCase()}`,
      html: `${nazwa} z końcówką <span class="lit">-${l.toUpperCase()}</span>`,
    });
  }

  function pasujeLitera(z, wpis) {
    const l = maleLitery(wpis);
    return (!z.litera || l.startsWith(z.litera)) && (!z.koniec || l.endsWith(z.koniec)) && (!z.minDlugosc || l.length >= z.minDlugosc);
  }

  function znajdzWKategorii(kat, wpis) {
    const n = norm(wpis);
    if (!n) return null;
    if (kat.indeks.has(n)) return kat.indeks.get(n);
    const wlasne = (pamiec.wlasne[kat.baza || kat.q] || []);
    if (wlasne.includes(n) && pasujeLitera(kat, wpis)) return { pokaz: wpis.trim(), pkt: PUNKTY_WLASNE, wlasne: true };
    let najlepsze = null, wynik = 9;
    const lim = tolerancja(n.length);
    const r = rdzen(n);
    for (const o of kat.odp) {
      for (const f of o.formy) {
        let d = lim > 0 ? odleglosc(n, f, lim) : 9;
        if (d > lim && r.length >= 4 && rdzen(f) === r) d = lim + 0.5;
        if (d <= lim + 0.5 && (d < wynik || (d === wynik && o.pkt < najlepsze.pkt))) { najlepsze = o; wynik = d; }
      }
    }
    return najlepsze;
  }

  // ---------- Słownik (zadania literowe) ----------
  const SLOWNIK = { slowa: [], z: [], dokl: new Map(), bezOgonkow: new Map(), gotowy: false };
  function dekodujSlownik() {
    const s = window.SLOWNIK || "";
    const slowa = SLOWNIK.slowa, z = SLOWNIK.z;
    let prev = "", i = 0;
    const n = s.length;
    while (i < n) {
      const k = s.charCodeAt(i) - 65;
      let j = ++i;
      while (j < n) { const c = s.charCodeAt(j); if (c >= 48 && c <= 57) break; j++; }
      const w = prev.slice(0, k) + s.slice(i, j);
      slowa.push(w);
      z.push((s.charCodeAt(j) - 48) * 10 + (s.charCodeAt(j + 1) - 48));
      prev = w; i = j + 2;
    }
    for (let x = 0; x < slowa.length; x++) {
      SLOWNIK.dokl.set(slowa[x], x);
      const b = norm(slowa[x]);
      const jest = SLOWNIK.bezOgonkow.get(b);
      if (jest === undefined || z[x] > z[jest]) SLOWNIK.bezOgonkow.set(b, x);
    }
    SLOWNIK.gotowy = true;
  }
  function punktyZeSlownika(z10) {
    const z = z10 / 10;
    if (z <= 0) return 100;
    return Math.max(4, Math.min(100, Math.round(100 - (z - 1.2) * 21)));
  }

  // Zadania literowe budowane ze słownika: początek, koniec, środek, długie słowa.
  let ZADANIA_LITEROWE = null;
  function zbudujZadaniaLiterowe() {
    if (ZADANIA_LITEROWE) return ZADANIA_LITEROWE;
    const pre2 = new Map(), pre3 = new Map(), suf3 = new Map(), suf4 = new Map(), mid3 = new Map(), dlugie = new Map();
    const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const w of SLOWNIK.slowa) {
      if (w.length < MIN_DLUGOSC_LITERY) continue;
      inc(pre2, w.slice(0, 2)); inc(pre3, w.slice(0, 3));
      inc(suf3, w.slice(-3)); if (w.length >= 6) inc(suf4, w.slice(-4));
      const widziane = new Set();
      for (let i = 1; i + 3 < w.length; i++) { const t = w.slice(i, i + 3); if (!widziane.has(t)) { widziane.add(t); inc(mid3, t); } }
      if (w.length >= 11) inc(dlugie, w[0]);
    }
    const wybierz = (m, prog) => [...m.entries()].filter(([, c]) => c >= prog).map(([k]) => k).sort();
    const lista = [];
    const duze = (t) => t.toUpperCase();
    for (const p of wybierz(pre2, 300)) lista.push({ klucz: "p:" + p, html: `Słowo na <span class="lit">${duze(p)}</span>`, opis: `zaczyna się na „${p}”`, test: (w) => w.startsWith(p) });
    for (const p of wybierz(pre3, 150)) lista.push({ klucz: "p:" + p, html: `Słowo na <span class="lit">${duze(p)}</span>`, opis: `zaczyna się na „${p}”`, test: (w) => w.startsWith(p) });
    for (const s of wybierz(suf3, 200)) lista.push({ klucz: "s:" + s, html: `Słowo kończące się na <span class="lit">-${duze(s)}</span>`, opis: `kończy się na „${s}”`, test: (w) => w.endsWith(s) });
    for (const s of wybierz(suf4, 120)) lista.push({ klucz: "s:" + s, html: `Słowo kończące się na <span class="lit">-${duze(s)}</span>`, opis: `kończy się na „${s}”`, test: (w) => w.endsWith(s) });
    for (const m of wybierz(mid3, 800)) lista.push({ klucz: "m:" + m, html: `Słowo z <span class="lit">${duze(m)}</span> w środku`, opis: `ma „${m}” w środku (nie na początku ani na końcu)`, test: (w) => w.indexOf(m, 1) > 0 && w.indexOf(m, 1) + 3 < w.length });
    const dokladnie = new Map(), poczKon = new Map();
    const KONCOWKI_ZADAN = ["a", "ć", "ść", "ek", "ka", "nik", "owy", "anie", "enie", "ny", "ik", "ia"];
    for (const w of SLOWNIK.slowa) {
      if (w.length < MIN_DLUGOSC_LITERY) continue;
      if (w.length >= 5 && w.length <= 10) inc(dokladnie, w[0] + w.length);
      for (const k of KONCOWKI_ZADAN) if (w.endsWith(k) && w.length > k.length + 1) inc(poczKon, w[0] + "|" + k);
    }
    for (const k of wybierz(dokladnie, 150)) {
      const l = k[0], n = Number(k.slice(1));
      lista.push({ klucz: "dl:" + k, html: `Słowo na <span class="lit">${duze(l)}</span>, dokładnie ${n} liter`, opis: `zaczyna się na „${l}” i ma dokładnie ${n} liter`, test: (w) => w.startsWith(l) && w.length === n });
    }
    for (const k of wybierz(poczKon, 80)) {
      const [l, kon] = k.split("|");
      lista.push({ klucz: "pk:" + k, html: `Słowo na <span class="lit">${duze(l)}</span> kończące się na <span class="lit">-${duze(kon)}</span>`, opis: `zaczyna się na „${l}” i kończy na „${kon}”`, test: (w) => w.startsWith(l) && w.endsWith(kon) && w.length > kon.length + 1 });
    }
    for (const l of wybierz(dlugie, 250)) lista.push({ klucz: "d:" + l, html: `Słowo na <span class="lit">${duze(l)}</span>, minimum 11 liter`, opis: `zaczyna się na „${l}” i ma co najmniej 11 liter`, test: (w) => w.startsWith(l) && w.length >= 11 });
    const specjalne = [
      ["x:zz", "Słowo z <span class=\"lit\">Ż</span> i <span class=\"lit\">Ó</span>", "ma literę „ż” i „ó”", (w) => w.includes("ż") && w.includes("ó")],
      ["x:ae", "Słowo z <span class=\"lit\">Ą</span> i <span class=\"lit\">Ę</span>", "ma literę „ą” i „ę”", (w) => w.includes("ą") && w.includes("ę")],
      ["x:sc", "Słowo z <span class=\"lit\">ŚĆ</span>", "zawiera „ść”", (w) => w.includes("ść")],
      ["x:dz", "Słowo z <span class=\"lit\">DŹ</span>", "zawiera „dź”", (w) => w.includes("dź")],
      ["x:rz", "Słowo z dwoma <span class=\"lit\">RZ</span>", "ma „rz” co najmniej dwa razy", (w) => (w.match(/rz/g) || []).length >= 2],
      ["x:ch", "Słowo z dwoma <span class=\"lit\">CH</span>", "ma „ch” co najmniej dwa razy", (w) => (w.match(/ch/g) || []).length >= 2],
      ["x:4a", "Słowo z czterema literami <span class=\"lit\">A</span>", "ma co najmniej cztery litery „a”", (w) => (w.match(/a/g) || []).length >= 4],
      ["x:14", "Słowo dłuższe niż <span class=\"lit\">14</span> liter", "ma co najmniej 15 liter", (w) => w.length >= 15],
      ["x:pal", "Słowo, które czyta się tak samo od tyłu", "jest palindromem (kajak, potop)", (w) => w.length >= 3 && w === [...w].reverse().join("")],
    ];
    for (const [klucz, html, opis, test] of specjalne) lista.push({ klucz, html, opis, test });
    ZADANIA_LITEROWE = lista.map((z) => ({ ...z, typ: "litery", paczka: "litery", q: z.html.replace(/<[^>]+>/g, "") }));
    return ZADANIA_LITEROWE;
  }

  function sprawdzSlowo(zad, wpis) {
    const czyste = maleLitery(wpis);
    if (!czyste) return { ok: false, powod: "Wpisz jedno słowo." };
    if (/\s/.test(wpis.trim())) return { ok: false, powod: "Tu liczy się jedno słowo, bez spacji." };
    let idx = SLOWNIK.dokl.get(czyste);
    if (idx === undefined) idx = SLOWNIK.bezOgonkow.get(norm(czyste));
    const wlasne = pamiec.wlasne["litery"] || [];
    if (idx === undefined) {
      if (wlasne.includes(norm(czyste)) && zad.test(czyste)) return { ok: true, pokaz: czyste, pkt: PUNKTY_WLASNE, wlasne: true };
      return { ok: false, powod: `Nie znam słowa „${czyste}”. Wpisz formę podstawową (mianownik, bezokolicznik).`, uznaj: true };
    }
    const w = SLOWNIK.slowa[idx];
    if (w.length < MIN_DLUGOSC_LITERY && zad.klucz !== "x:pal") return { ok: false, powod: `Za krótkie. Słowo musi mieć co najmniej ${MIN_DLUGOSC_LITERY} litery.` };
    if (!zad.test(w)) return { ok: false, powod: `„${w}” nie pasuje: słowo ${zad.opis}.` };
    return { ok: true, pokaz: w, pkt: punktyZeSlownika(SLOWNIK.z[idx]) };
  }

  // ---------- Losowanie ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const losuj = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function tasuj(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function dzisiaj() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function wczoraj() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Najpierw losujemy rodzaj zadania (początek, koniec, środek…), potem konkretne zadanie.
  function losujLiterowe(rng, ile) {
    const grupy = new Map();
    for (const z of zbudujZadaniaLiterowe()) {
      const g = z.klucz.split(":")[0];
      if (!grupy.has(g)) grupy.set(g, []);
      grupy.get(g).push(z);
    }
    const out = [];
    const rodzaje = [...grupy.keys()].sort();
    while (out.length < ile) {
      const z = losuj(rng, grupy.get(losuj(rng, rodzaje)));
      if (!out.includes(z)) out.push(z);
    }
    return out;
  }

  function zestawDnia(data) {
    const rng = mulberry32(Number(data.replace(/-/g, "")) * 2654435761 % 4294967296);
    const paczki = tasuj(rng, [...new Set(KATEGORIE.map((k) => k.paczka))]);
    const kat = paczki.slice(0, 5).map((p, i) => losuj(rng, (i < 3 ? KATEGORIE : KOMBINACJE).filter((k) => k.paczka === p)));
    const lit = losujLiterowe(rng, 2);
    const wynik = tasuj(rng, kat.concat(lit));
    return wynik;
  }
  function zestawPaczki(paczka) {
    const rng = Math.random;
    if (paczka === "litery") return losujLiterowe(rng, RUND_W_NURKOWANIU);
    const zwykle = tasuj(rng, KATEGORIE.filter((k) => k.paczka === paczka));
    const zLitera = tasuj(rng, KOMBINACJE.filter((k) => k.paczka === paczka));
    const out = [];
    while (out.length < RUND_W_NURKOWANIU) {
      const zrodlo = rng() < 0.55 && zwykle.length ? zwykle : zLitera.length ? zLitera : zwykle;
      out.push(zrodlo.pop() || losuj(rng, KATEGORIE.filter((k) => k.paczka === paczka)));
    }
    return out;
  }
  let ostatnieBezKonca = [];
  function nastepneBezKonca() {
    let z;
    for (let i = 0; i < 20; i++) {
      const r = Math.random();
      z = r < 0.45 ? losuj(Math.random, KATEGORIE) : r < 0.75 ? losuj(Math.random, KOMBINACJE) : losujLiterowe(Math.random, 1)[0];
      if (!ostatnieBezKonca.includes(z.q)) break;
    }
    ostatnieBezKonca = [z.q, ...ostatnieBezKonca].slice(0, 25);
    return z;
  }

  // ---------- Formatowanie ----------
  const fmtM = (m) => `${m.toLocaleString("pl-PL")} m`;
  function strefa(m) { let s = STREFY[0]; for (const x of STREFY) if (m >= x.od) s = x; return s; }
  function poziomZPunktow(pkt, wlasne) {
    if (wlasne) return 5;
    if (!pkt) return 0;
    return pkt < 27 ? 1 : pkt < 53 ? 2 : pkt < 81 ? 3 : 4;
  }
  function popularnosc(pkt) {
    const p = 30 * Math.exp(-pkt / 17);
    if (p < 0.1) return "poniżej 0,1%";
    return "~" + (p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)).toString().replace(".", ",") + "%";
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Sonda głębokości i tło ----------
  const el = (id) => document.getElementById(id);
  const ekran = el("ekran");
  const KOLORY_TLA = [
    [0, "#2a86b4", "#0e3f63"], [600, "#145a85", "#0a3253"], [1500, "#0c3a62", "#061f3b"],
    [4000, "#082647", "#03122a"], [7000, "#05162e", "#020a19"], [11000, "#030b1c", "#01040c"],
  ];
  function mieszaj(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const kan = (x, s) => (x >> s) & 255;
    const c = (s) => Math.round(kan(pa, s) + (kan(pb, s) - kan(pa, s)) * t);
    return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
  }
  function ustawGlebokosc(m) {
    el("sondaM").textContent = "▼ " + fmtM(m);
    el("sondaStrefa").textContent = m === 0 ? "Powierzchnia" : strefa(m).nazwa;
    el("skalaWyp").style.width = Math.min(100, (m / MAKS_SKALI) * 100) + "%";
    let i = 0;
    while (i < KOLORY_TLA.length - 2 && m > KOLORY_TLA[i + 1][0]) i++;
    const [m0, g0, d0] = KOLORY_TLA[i], [m1, g1, d1] = KOLORY_TLA[i + 1];
    const t = Math.max(0, Math.min(1, (m - m0) / (m1 - m0)));
    document.documentElement.style.setProperty("--bg-top", mieszaj(g0, g1, t));
    document.documentElement.style.setProperty("--bg-bottom", mieszaj(d0, d1, t));
    document.documentElement.style.setProperty("--swiatlo", Math.max(0, 1 - m / 900).toFixed(3));
    snieg.glebia = Math.min(1, m / 8000);
  }
  for (const z of ZNACZNIKI) {
    const d = document.createElement("div");
    d.className = "znacznik";
    d.style.left = (z / MAKS_SKALI) * 100 + "%";
    el("skala").appendChild(d);
  }

  // Morski śnieg: drobinki unoszące się w toni (w górę = schodzimy w dół).
  const snieg = { glebia: 0, zryw: 0 };
  (function animujSnieg() {
    const c = el("snieg"), ctx = c.getContext("2d");
    const ruch = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let czastki = [];
    function rozmiar() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = innerWidth * dpr; c.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((innerWidth * innerHeight) / 9000);
      czastki = Array.from({ length: n }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.6 + 0.3, v: Math.random() * 0.25 + 0.05, f: Math.random() * Math.PI * 2 }));
    }
    function klatka(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of czastki) {
        if (ruch) { p.y -= p.v * (1 + snieg.glebia + snieg.zryw * 14); p.x += Math.sin(t / 2400 + p.f) * 0.08; if (p.y < -4) { p.y = innerHeight + 4; p.x = Math.random() * innerWidth; } }
        const swiat = snieg.glebia > 0.35 && p.r > 1.5;
        ctx.fillStyle = swiat ? `rgba(134, 230, 255, ${0.35 + 0.35 * Math.sin(t / 900 + p.f)})` : `rgba(220, 240, 255, ${0.18 + p.r * 0.12})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      if (ruch) requestAnimationFrame(klatka);
    }
    addEventListener("resize", () => { rozmiar(); if (!ruch) klatka(0); });
    rozmiar();
    requestAnimationFrame(klatka);
  })();

  // ---------- Animacja nurkowania ----------
  const BEZ_RUCHU = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ladneKroki = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Kryl opada w toń: miarka głębokości przesuwa się w górę, licznik metrów rośnie,
  // woda ciemnieje, a z nurka lecą bąbelki. Kliknięcie lub klawisz kończy od razu.
  function animujNurkowanie(od, doM, pkt, poziom, wlasne) {
    if (BEZ_RUCHU || doM <= od) return Promise.resolve();
    const warstwa = el("nurkowanie"), linijka = el("linijka"), nurek = el("nurek");
    const licznikM = el("licznikM"), licznikStrefa = el("licznikStrefa"), pod = el("licznikPod");
    const roznica = doM - od;
    const czas = 1500 + Math.min(1700, roznica * 1.6);
    const skala = Math.max(0.35, Math.min(4, 900 / roznica));
    const krok = ladneKroki.find((k) => k * skala >= 70) || 5000;
    const srodek = innerHeight * 0.42;

    linijka.innerHTML = "";
    const kreski = [];
    const pocz = Math.floor((od - srodek / skala) / krok) * krok;
    const kon = doM + (innerHeight - srodek) / skala + krok;
    for (let m = Math.max(0, pocz); m <= kon; m += krok / 2) {
      const duza = m % krok === 0;
      const k = document.createElement("div");
      k.className = "kreska" + (duza ? "" : " mala");
      if (duza) k.innerHTML = `<span>${fmtM(m)}</span>`;
      linijka.appendChild(k);
      kreski.push([k, m]);
    }
    for (const z of ZNACZNIKI) {
      if (z < pocz || z > kon) continue;
      const k = document.createElement("div");
      k.className = "kreska strefa";
      k.innerHTML = `<span>${strefa(z).nazwa}</span>`;
      linijka.appendChild(k);
      kreski.push([k, z]);
    }
    const P = POZIOMY[poziom];
    pod.className = "pod";
    pod.innerHTML = `<b>+${pkt} pkt</b><span class="chip ${P.kl}">${P.nazwa}</span>`;

    warstwa.hidden = false;
    warstwa.removeAttribute("aria-hidden");
    requestAnimationFrame(() => warstwa.classList.add("widoczne"));

    return new Promise((gotowe) => {
      let start = null, koniec = false, ostatniBabel = 0;
      const zakoncz = () => {
        if (koniec) return;
        koniec = true;
        removeEventListener("keydown", klawisz);
        rysuj(doM, 1, performance.now());
        pod.classList.add("widoczne");
        snieg.zryw = 0;
        setTimeout(() => {
          warstwa.classList.remove("widoczne");
          setTimeout(() => { warstwa.hidden = true; warstwa.setAttribute("aria-hidden", "true"); gotowe(); }, 350);
        }, 650);
      };
      const pomin = () => { start = -1e9; };
      warstwa.onclick = pomin;
      // Enter, którym wysłano odpowiedź, nie może od razu pominąć animacji.
      const odKiedy = performance.now() + 300;
      const klawisz = (e) => {
        if (performance.now() < odKiedy || e.repeat) return;
        if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); pomin(); }
      };
      addEventListener("keydown", klawisz);

      function rysuj(m, t, now) {
        licznikM.textContent = "▼ " + fmtM(Math.round(m));
        licznikStrefa.textContent = strefa(m).nazwa;
        for (const [k, km] of kreski) k.style.transform = `translateY(${srodek + (km - m) * skala}px)`;
        const predkosc = Math.sin(Math.PI * t);
        const kolys = Math.sin(now / 260) * 4;
        nurek.style.transform = `translateY(${kolys + predkosc * 18}px) rotate(${18 + predkosc * 52}deg)`;
        snieg.zryw = predkosc;
        ustawGlebokosc(Math.round(m));
      }
      function babel(now) {
        if (now - ostatniBabel < 110) return;
        ostatniBabel = now;
        const b = document.createElement("div");
        const r = 6 + Math.random() * 14;
        const box = nurek.getBoundingClientRect();
        b.className = "babel";
        b.style.width = b.style.height = r + "px";
        b.style.left = box.left + box.width * (0.35 + Math.random() * 0.3) + "px";
        b.style.top = box.top + box.height * 0.3 + "px";
        b.style.setProperty("--dx", (Math.random() * 60 - 30) + "px");
        warstwa.appendChild(b);
        setTimeout(() => b.remove(), 1700);
      }
      function klatka(now) {
        if (start === null) start = now;
        const t = Math.min(1, (now - start) / czas);
        if (koniec) return;
        rysuj(od + roznica * easeInOut(t), t, now);
        if (t < 0.92) babel(now);
        if (t >= 1) return zakoncz();
        requestAnimationFrame(klatka);
      }
      requestAnimationFrame(klatka);
    });
  }

  // ---------- Stan gry ----------
  let gra = null;
  let zegarId = null;

  function zatrzymajZegar() { if (zegarId) { cancelAnimationFrame(zegarId); zegarId = null; } }

  function nowaGra(tryb, zadania, opcje = {}) {
    zatrzymajZegar();
    gra = { tryb, zadania, idx: 0, wyniki: [], glebia: 0, butle: BUTLE_TLENU, ...opcje };
    ustawGlebokosc(0);
    runda();
  }

  function biezace() {
    if (gra.tryb === "bezkonca" && !gra.zadania[gra.idx]) gra.zadania.push(nastepneBezKonca());
    return gra.zadania[gra.idx];
  }

  function naglowekRundy() {
    const z = biezace();
    const lewa = gra.tryb === "bezkonca" ? `Runda ${gra.idx + 1}` : `Pytanie ${gra.idx + 1}/${gra.zadania.length}`;
    const paczka = NAZWY_PACZEK[z.paczka] || z.paczka;
    const butle = gra.tryb === "bezkonca"
      ? `<span class="butle" aria-label="Tlen: ${gra.butle} z ${BUTLE_TLENU}">${Array.from({ length: BUTLE_TLENU }, (_, i) => `<span class="butla${i < gra.butle ? " pelna" : ""}"></span>`).join("")}</span>`
      : `<span>${esc(paczka)}</span>`;
    return `<div class="meta"><span>${lewa}${gra.tryb === "bezkonca" ? " · " + esc(paczka) : ""}</span>${butle}</div>`;
  }

  function runda() {
    const z = biezace();
    const pytanieHtml = z.html || esc(z.q);
    const podp = z.typ === "kategoria"
      ? "Podaj coś z tej kategorii. Im rzadsza odpowiedź, tym głębiej zanurkujesz."
      : "Dowolne polskie słowo w formie podstawowej. Rzadkie słowa dają najwięcej punktów.";
    ekran.innerHTML = `
      <section class="panel runda" aria-live="polite">
        ${naglowekRundy()}
        <h2 class="pytanie">${pytanieHtml}</h2>
        <p class="podpowiedz">${podp}</p>
        <div>
          <div class="zegar" id="zegar"><div id="zegarPasek"></div></div>
          <div class="sekundy" id="sekundy">${CZAS_RUNDY} s</div>
        </div>
        <form class="wpis" id="wpis" autocomplete="off">
          <input id="odpowiedz" name="odpowiedz" type="text" placeholder="Twoja odpowiedź…" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="60" aria-label="Twoja odpowiedź">
          <button class="przycisk" type="submit">Zanurz</button>
        </form>
        <div class="komunikat" id="komunikat"></div>
        <div class="proby" id="proby"></div>
        <div class="rzad"><button class="linkowy" type="button" id="pas">Pas, pokaż odpowiedzi</button></div>
      </section>`;
    const input = el("odpowiedz");
    input.focus({ preventScroll: true });
    gra.proby = [];
    el("wpis").addEventListener("submit", (e) => { e.preventDefault(); sprobuj(input.value); });
    el("pas").addEventListener("click", () => zakonczRunde(null));
    const start = performance.now();
    gra.koniecCzasu = start + CZAS_RUNDY * 1000;
    const pasek = el("zegarPasek"), sek = el("sekundy"), zegar = el("zegar");
    const tik = (t) => {
      const zostalo = Math.max(0, gra.koniecCzasu - t);
      pasek.style.transform = `scaleX(${zostalo / (CZAS_RUNDY * 1000)})`;
      sek.textContent = Math.ceil(zostalo / 1000) + " s";
      zegar.classList.toggle("koniec", zostalo < 6000);
      if (zostalo <= 0) { zegarId = null; zakonczRunde(null, true); return; }
      zegarId = requestAnimationFrame(tik);
    };
    zegarId = requestAnimationFrame(tik);
  }

  function sprobuj(wartosc) {
    const z = biezace();
    const wpis = wartosc.trim();
    const kom = el("komunikat");
    if (!wpis) return;
    let wynik;
    if (z.typ === "kategoria") {
      const o = znajdzWKategorii(z, wpis);
      wynik = o ? { ok: true, pokaz: o.pokaz, pkt: o.pkt, wlasne: !!o.wlasne } : { ok: false, powod: `„${wpis}” nie ma na liście dla tej kategorii.`, uznaj: true };
    } else {
      wynik = sprawdzSlowo(z, wpis);
    }
    if (wynik.ok) { zakonczRunde({ ...wynik, wpis }); return; }
    gra.proby.push(wpis);
    el("proby").innerHTML = gra.proby.slice(-6).map((p) => `<span class="proba">${esc(p)}</span>`).join("");
    kom.className = "komunikat zly";
    kom.innerHTML = `<span>${esc(wynik.powod)}</span>` + (wynik.uznaj ? `<button class="przycisk drugi" type="button" id="uznaj">Uznaj „${esc(wpis)}”</button>` : "");
    if (wynik.uznaj) el("uznaj").addEventListener("click", () => uznajWlasne(z, wpis));
    const form = el("wpis");
    form.classList.remove("potrzasnij"); void form.offsetWidth; form.classList.add("potrzasnij");
    const input = el("odpowiedz");
    input.select();
  }

  function uznajWlasne(z, wpis) {
    const klucz = z.typ === "kategoria" ? (z.baza || z.q) : "litery";
    const n = norm(wpis);
    if (!pasujeLitera(z, wpis)) {
      const kom = el("komunikat");
      kom.className = "komunikat zly";
      kom.textContent = z.litera ? `„${wpis}” nie zaczyna się na literę ${z.litera.toUpperCase()}.` : z.koniec ? `„${wpis}” nie kończy się na literę ${z.koniec.toUpperCase()}.` : `„${wpis}” ma mniej niż ${z.minDlugosc} liter.`;
      return;
    }
    if (z.typ === "litery" && !z.test(maleLitery(wpis))) {
      const kom = el("komunikat");
      kom.className = "komunikat zly";
      kom.textContent = `„${wpis}” nie spełnia warunku: słowo ${z.opis}.`;
      return;
    }
    pamiec.wlasne[klucz] = [...new Set([...(pamiec.wlasne[klucz] || []), n])];
    zapisz();
    zakonczRunde({ ok: true, pokaz: z.typ === "kategoria" ? wpis.trim() : maleLitery(wpis), pkt: PUNKTY_WLASNE, wlasne: true, wpis });
  }

  function ujawnienie(z, odp) {
    if (z.typ === "kategoria") {
      const najczestsze = z.odp.slice(0, 6).map((o) => o.pokaz);
      const rzadkie = z.odp.filter((o) => o.pkt >= 82);
      const perelki = tasuj(Math.random, rzadkie).slice(0, 5).map((o) => o.pokaz);
      return { najczestsze, perelki, ile: z.odp.length };
    }
    const pas = [];
    for (let i = 0; i < SLOWNIK.slowa.length; i++) {
      const w = SLOWNIK.slowa[i];
      if ((w.length >= MIN_DLUGOSC_LITERY || z.klucz === "x:pal") && z.test(w)) pas.push(i);
    }
    const najczestsze = pas.slice().sort((a, b) => SLOWNIK.z[b] - SLOWNIK.z[a]).slice(0, 6).map((i) => SLOWNIK.slowa[i]);
    const rzadkie = pas.filter((i) => SLOWNIK.z[i] >= 8 && SLOWNIK.z[i] <= 18);
    const perelki = tasuj(Math.random, rzadkie.length ? rzadkie : pas).slice(0, 5).map((i) => SLOWNIK.slowa[i]);
    return { najczestsze, perelki, ile: pas.length };
  }

  async function zakonczRunde(odp, czas = false) {
    zatrzymajZegar();
    if (gra.konczy) return;
    gra.konczy = true;
    const z = biezace();
    const pkt = odp ? odp.pkt : 0;
    const poziom = poziomZPunktow(pkt, odp && odp.wlasne);
    const przed = gra.glebia;
    gra.glebia += pkt * METRY_ZA_PUNKT;
    gra.wyniki.push({ q: z.q, slowo: odp ? odp.pokaz : null, pkt, poziom });
    if (odp) {
      pamiec.odkryte[z.q + "|" + norm(odp.pokaz)] = 1;
      zapisz();
    }
    if (gra.tryb === "bezkonca" && !odp) gra.butle -= 1;
    const input = el("odpowiedz");
    if (input) input.blur();
    await animujNurkowanie(przed, gra.glebia, pkt, poziom, odp && odp.wlasne);
    gra.konczy = false;
    ustawGlebokosc(gra.glebia);
    const u = ujawnienie(z, odp);
    const ostatnia = gra.tryb === "bezkonca" ? gra.butle <= 0 : gra.idx + 1 >= gra.zadania.length;
    const P = POZIOMY[poziom];
    const glowna = odp
      ? `<p class="etykieta">Twoja odpowiedź</p>
         <h2 class="slowo">${esc(odp.pokaz)}</h2>
         <div class="punkty"><b>+${pkt}</b><span class="chip ${P.kl}">${P.nazwa}</span><span class="popularnosc">${odp.wlasne ? "Słowo dodane do Twojego słownika" : "Szacowana popularność: " + popularnosc(pkt)}</span></div>
         <div class="popularnosc">Schodzisz o ${fmtM(pkt * METRY_ZA_PUNKT)} w dół.</div>`
      : `<p class="etykieta">${czas ? "Skończył się czas" : "Pas"}</p>
         <h2 class="slowo">0 pkt</h2>
         <div class="popularnosc">${gra.tryb === "bezkonca" ? `Tracisz butlę tlenu. Zostało: ${gra.butle}.` : "Tym razem bez zanurzenia."}</div>`;
    ekran.innerHTML = `
      <section class="panel wynik wejscie" aria-live="polite">
        ${naglowekRundy()}
        <p class="podpowiedz">${z.html || esc(z.q)}</p>
        ${glowna}
        <p class="lista"><b>Najczęstsze odpowiedzi:</b> ${u.najczestsze.map(esc).join(", ")}</p>
        <p class="lista"><b>Rzadkie perełki:</b> ${u.perelki.map(esc).join(", ") || "brak"}</p>
        <p class="lista">Pasujących słów w bazie: ${u.ile.toLocaleString("pl-PL")}</p>
        <div class="rzad"><button class="przycisk" type="button" id="dalej">${ostatnia ? "Wynurz się i zobacz wynik" : "Dalej w dół"}</button></div>
      </section>`;
    const dalej = el("dalej");
    const gotowe = performance.now() + 350; // nie przeskakuj rundy przytrzymanym Enterem
    dalej.focus({ preventScroll: true });
    dalej.addEventListener("click", () => {
      if (performance.now() < gotowe) return;
      if (ostatnia) return podsumowanie();
      gra.idx += 1;
      runda();
    });
  }

  function podsumowanie(tylkoPokaz = false) {
    const m = gra.glebia;
    const s = strefa(m);
    const nowyRekord = !tylkoPokaz && m > pamiec.rekord;
    if (!tylkoPokaz) {
      pamiec.gry += 1;
      pamiec.lacznie += m;
      if (nowyRekord) pamiec.rekord = m;
    }
    if (gra.tryb === "dzien" && !tylkoPokaz) {
      const d = dzisiaj();
      if (!pamiec.dni[d]) {
        pamiec.seria = pamiec.ostatniDzien === wczoraj() ? pamiec.seria + 1 : 1;
        pamiec.ostatniDzien = d;
        pamiec.dni[d] = { m, w: gra.wyniki.map((r) => [r.slowo, r.pkt, r.poziom]) };
      }
    }
    zapisz();
    const tytul = gra.tryb === "dzien" ? "Nurkowanie dnia" : gra.tryb === "bezkonca" ? "Bez końca" : "Paczka: " + (NAZWY_PACZEK[gra.paczka] || gra.paczka);
    const kafelki = gra.wyniki.map((r) => POZIOMY[r.poziom].emoji).join("");
    const tekst = `Głębina · ${tytul}${gra.tryb === "dzien" ? " · " + dzisiaj() : ""}\n▼ ${fmtM(m)} · ${s.nazwa}\n${kafelki}`;
    ekran.innerHTML = `
      <section class="panel koniec runda">
        <p class="etykieta">${esc(tytul)}${nowyRekord && m > 0 ? " · nowy rekord!" : ""}</p>
        <h2>▼ ${fmtM(m)}</h2>
        <div><div class="strefa-duza">${s.nazwa}</div><p class="stworzenie">${s.stwor}</p></div>
        <table class="tabela"><tbody>
          ${gra.wyniki.map((r) => `<tr><td>${esc(r.q)}</td><td class="w">${r.slowo ? esc(r.slowo) : "—"}</td><td>${r.pkt ? "+" + r.pkt : "0"}</td></tr>`).join("")}
        </tbody></table>
        <div>
          <p class="etykieta">Do skopiowania</p>
          <pre class="udostepnij" id="tekstWyniku">${esc(tekst)}</pre>
        </div>
        <div class="rzad">
          <button class="przycisk" type="button" id="kopiuj">Kopiuj wynik</button>
          ${gra.tryb === "dzien" ? "" : `<button class="przycisk drugi" type="button" id="jeszcze">Jeszcze raz</button>`}
          <button class="przycisk drugi" type="button" id="menu">Menu</button>
        </div>
        <div class="komunikat" id="komunikat"></div>
      </section>`;
    el("kopiuj").addEventListener("click", () => {
      const k = el("komunikat");
      const zaznacz = () => { const r = document.createRange(); r.selectNodeContents(el("tekstWyniku")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); k.textContent = "Tekst zaznaczony. Skopiuj go skrótem klawiszowym."; };
      try {
        navigator.clipboard.writeText(tekst).then(() => { k.textContent = "Skopiowano."; }, zaznacz);
      } catch { zaznacz(); }
    });
    if (el("jeszcze")) el("jeszcze").addEventListener("click", () => {
      if (gra.tryb === "bezkonca") nowaGra("bezkonca", []);
      else nowaGra("paczka", zestawPaczki(gra.paczka), { paczka: gra.paczka });
    });
    el("menu").addEventListener("click", menu);
    el("menu").focus({ preventScroll: true });
  }

  // ---------- Menu ----------
  function menu() {
    zatrzymajZegar();
    gra = null;
    ustawGlebokosc(0);
    const d = dzisiaj();
    const dzis = pamiec.dni[d];
    const seria = pamiec.ostatniDzien === d || pamiec.ostatniDzien === wczoraj() ? pamiec.seria : 0;
    const liczbaOdp = KATEGORIE.reduce((s, k) => s + k.odp.length, 0);
    const liczbaPytan = KATEGORIE.length + KOMBINACJE.length + zbudujZadaniaLiterowe().length;
    const paczki = [...new Set(KATEGORIE.map((k) => k.paczka))];
    ekran.innerHTML = `
      <section class="bohater">
        <h1>Głębina<span>.</span></h1>
        <p>Dostajesz kategorię i ${CZAS_RUNDY} sekund. Wymyśl odpowiedź, na którą nikt inny by nie wpadł. Im rzadsze słowo, tym głębiej schodzisz pod wodę.</p>
      </section>
      <section class="tryby">
        <button class="tryb glowny" type="button" id="trybDzien">
          <span class="nazwa">Nurkowanie dnia</span>
          <span class="opis">${dzis ? `Dziś: ▼ ${fmtM(dzis.m)}. Wróć jutro po nowe pytania.` : `${RUND_W_NURKOWANIU} pytań, takich samych przez cały dzień.`}</span>
          <span class="strzalka">${dzis ? "wynik" : "start"} →</span>
        </button>
        <button class="tryb" type="button" id="trybBez">
          <span class="nazwa">Bez końca</span>
          <span class="opis">Masz ${BUTLE_TLENU} butle tlenu. Każda runda bez punktów zabiera jedną.</span>
          <span class="strzalka">start →</span>
        </button>
      </section>
      <section class="panel">
        <p class="etykieta">Paczki tematyczne · ${RUND_W_NURKOWANIU} pytań</p>
        <div class="paczki">
          ${paczki.map((p) => `<button class="paczka" type="button" data-p="${esc(p)}"><b>${esc(NAZWY_PACZEK[p] || p)}</b><small>${KATEGORIE.filter((k) => k.paczka === p).length} kategorii</small></button>`).join("")}
          <button class="paczka" type="button" data-p="litery"><b>Litery</b><small>${SLOWNIK.slowa.length.toLocaleString("pl-PL")} słów</small></button>
        </div>
      </section>
      <section class="panel">
        <p class="etykieta">Twój dziennik nurka</p>
        <div class="statystyki">
          <div class="stat"><b>${fmtM(pamiec.rekord)}</b><span>Rekord</span></div>
          <div class="stat"><b>${seria}</b><span>Seria dni</span></div>
          <div class="stat"><b>${pamiec.gry}</b><span>Nurkowania</span></div>
          <div class="stat"><b>${Object.keys(pamiec.odkryte).length.toLocaleString("pl-PL")}</b><span>Odkryte słowa</span></div>
        </div>
      </section>
      <p class="stopka"><b>${liczbaPytan.toLocaleString("pl-PL")}</b> pytań · ${KATEGORIE.length} kategorii · <b>${liczbaOdp.toLocaleString("pl-PL")}</b> odpowiedzi · <b>${SLOWNIK.slowa.length.toLocaleString("pl-PL")}</b> słów w słowniku · <button class="linkowy" type="button" id="zasady">Jak grać</button></p>`;
    el("trybDzien").addEventListener("click", () => {
      if (pamiec.dni[d]) return pokazDzien(d);
      nowaGra("dzien", zestawDnia(d));
    });
    el("trybBez").addEventListener("click", () => nowaGra("bezkonca", []));
    for (const b of ekran.querySelectorAll(".paczka")) {
      b.addEventListener("click", () => nowaGra("paczka", zestawPaczki(b.dataset.p), { paczka: b.dataset.p }));
    }
    el("zasady").addEventListener("click", zasady);
  }

  function pokazDzien(d) {
    const dzis = pamiec.dni[d];
    const zad = zestawDnia(d);
    gra = { tryb: "dzien", glebia: dzis.m, wyniki: zad.map((z, i) => ({ q: z.q, slowo: dzis.w[i] ? dzis.w[i][0] : null, pkt: dzis.w[i] ? dzis.w[i][1] : 0, poziom: dzis.w[i] ? dzis.w[i][2] : 0 })) };
    ustawGlebokosc(dzis.m);
    podsumowanie(true);
  }

  function zasady() {
    ekran.innerHTML = `
      <section class="panel zasady runda">
        <h2 class="pytanie">Jak grać</h2>
        <ol>
          <li>Widzisz <b>kategorię</b> (np. „Owoc”) albo <b>zadanie literowe</b> (np. „Słowo na PR”).</li>
          <li>Masz <b>${CZAS_RUNDY} sekund</b>. Możesz próbować wiele razy, liczy się pierwsza poprawna odpowiedź.</li>
          <li><b>Rzadkie odpowiedzi dają więcej punktów.</b> Jabłko to kilka punktów, pigwa kilkadziesiąt, a jagoda kamczacka prawie sto.</li>
          <li>Każdy punkt to <b>${METRY_ZA_PUNKT} metrów</b> głębiej. Spróbuj dotrzeć do Rowu Mariańskiego.</li>
          <li>Wielkość liter i polskie znaki nie mają znaczenia. Literówki i liczba mnoga też zwykle przejdą.</li>
          <li>Gra nie zna Twojego słowa, a wiesz, że jest dobre? Kliknij <b>Uznaj</b>. Dostaniesz ${PUNKTY_WLASNE} pkt, a słowo trafi do Twojego słownika.</li>
        </ol>
        <div>
          <p class="etykieta">Strefy oceanu</p>
          <div class="strefy">${STREFY.map((s) => `<div><span>${fmtM(s.od)}</span><span>${s.nazwa}</span></div>`).join("")}</div>
        </div>
        <div class="rzad"><button class="przycisk" type="button" id="wroc">Wracam do gry</button></div>
      </section>`;
    el("wroc").addEventListener("click", menu);
  }

  el("logo").addEventListener("click", menu);

  dekodujSlownik();
  menu();
})();
