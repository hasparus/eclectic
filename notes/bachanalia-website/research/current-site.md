# Current site: bachanaliafantastyczne.pl

Researched 2026-07-02. Caveat: the domain was unreachable from the research
sandbox (egress proxy denied CONNECT), so everything here comes from
search-indexed URLs and third-party sources — **not** from the live HTML.
The items in "To verify" below need a quick local check.

## Facts

- Homepage title: "Bachanalia Fantastyczne – XL Ogólnopolski festiwal
  popkultury" — 40th edition, Sept 25–27 2026, UZ Campus B, Wojska
  Polskiego 69, Zielona Góra. Holds Polcon rank in 2026.
- Organizer: Zielonogórski Klub Fantastyki "Ad Astra"; co-organizer
  University of Zielona Góra.
- Polish only, no language switcher in evidence.

## Information architecture (from indexed URLs)

| Menu label          | Path                          | Purpose                       |
| ------------------- | ----------------------------- | ----------------------------- |
| CO TO SĄ BACHANALIA | `/index.php/co-to-sa-bachanalia/` | About                     |
| CZAS I MIEJSCE      | `/index.php/czas-i-miejsce/`  | Date & venue                  |
| ORGANIZATOR         | `/index.php/organizator/`     | Organizer                     |
| TABELA PROGRAMOWA   | `/index.php/program/`         | Programme table               |
| Program             | `/program/program/`           | Programme (no index.php!)     |
| ZGŁOSZENIA PROGRAMU | `/index.php/zgloszenia-programu/` | Programme submissions     |
| ZGŁOSZENIA OBSŁUGI  | `/index.php/zgloszenia-obslugi/`  | Staff/volunteer signup    |
| AKREDYTACJA         | `/index.php/akredytacja/`     | Tickets (30/40/80 PLN tiers)  |
| REGULAMIN           | `/index.php/regulamin/`       | Rules                         |
| WSPIERAJĄ NAS       | `/index.php/wspieraja-nas/`   | Sponsors/partners             |
| POZNAJ WYSTAWCÓW    | `/index.php/poznaj-wystawcow/`| Exhibitors                    |

No blog/news index, FAQ, or contact page surfaced in search results (may
exist unindexed).

Programme content per external descriptions: games room (~500 board games),
RPG sessions (3–4h long / 2h short), panels with writers, tournaments,
workshops, quizzes, wargaming and miniature painting, Eastern-European
culture section. Programme items are community-submitted.

## WordPress signals

- `/index.php/slug/` permalinks = classic WP PATHINFO ("almost pretty")
  format, i.e. clean rewrites were never configured. Will need switching to
  "Post name" permalinks for headless, plus 301s for old URLs.
- The `/program/program/` route without the `index.php` prefix is an
  inconsistency worth investigating (mixed rewrite config or duplicate page).
- Theme, plugins, REST API status, GraphQL, hosting provider: **unknown** —
  blocked from sandbox.

## To verify (run locally)

```sh
curl -s https://bachanaliafantastyczne.pl/wp-json/ | head -c 400        # REST enabled?
curl -s https://bachanaliafantastyczne.pl/wp-json/wp/v2/types | head    # CPTs?
curl -s -o /dev/null -w '%{http_code}' https://bachanaliafantastyczne.pl/graphql  # WPGraphQL?
curl -sI https://bachanaliafantastyczne.pl/ | grep -i 'server\|x-powered\|via'    # hosting hints
curl -s https://bachanaliafantastyczne.pl/ | grep -o 'wp-content/[^"]*' | sort -u | head -20  # theme/plugins
```
