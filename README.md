# Głębina

Polska gra słowna w stylu Krillion. Dostajesz kategorię (np. „Owoc”, „Coś, co lata”)
albo zadanie literowe (np. „Słowo na PR”) i masz 25 sekund na odpowiedź.
Im rzadsze słowo, tym więcej punktów, a każdy punkt to 10 metrów głębiej pod wodą.

Ponad 5,7 tys. pytań: 171 kategorii (ponad 37 tys. odpowiedzi), ich warianty
z literą („Owoc na literę P”, „Ssak z końcówką -N”, „Ser, co najmniej 10 liter”)
oraz zadania literowe na słowniku prawie 200 tys. słów.

## Tryby

- **Nurkowanie dnia**: 7 pytań, takich samych przez cały dzień, liczy się seria dni.
- **Bez końca**: grasz do utraty 3 butli tlenu (runda bez punktów zabiera jedną).
- **Paczki tematyczne**: 7 pytań z wybranej dziedziny albo same zadania literowe.

## Dane

- `data/kategorie/*.txt`: ręcznie spisane kategorie. Każda odpowiedź ma poziom
  popularności od 1 (najczęstsze) do 4 (perełki). Warianty oddziela `/`.
- `dane/kategorie.js`: kategorie z policzonymi punktami. W obrębie poziomu
  punkty zależą od tego, jak często słowo występuje w polszczyźnie (wordfreq).
- `dane/slownik.js`: słownik do zadań literowych (hasła ze słownika hunspell
  pl_PL połączone z częstościami wordfreq).

Przebudowa danych:

```sh
pip install wordfreq spylls
npm pack dictionary-pl && tar xzf dictionary-pl-*.tgz
python narzedzia/buduj_dane.py --hunspell package/index --cache /tmp/czestosci.json
```

## Uruchomienie

Wystarczy otworzyć `index.html` w przeglądarce. Wyniki, seria i własne słowa
zapisują się w pamięci przeglądarki.
