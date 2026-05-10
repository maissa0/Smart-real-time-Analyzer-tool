# FaultDonutChartComponent — Fault Distribution doughnut chart

## Ce qui a été fait

- Création de **`Frontend_angular/src/app/features/dashboard/fault-donut-chart/fault-donut-chart.component.ts`** (**standalone**) : donut **Chart.js**, **`INPUT` signal** **`FaultEntry[]`**, **`computed` `hasData`**, **`Chart.register`** (Arc/Doughnut/Tooltip — idempotent avec les autres fichiers).
- Étiquettes **HTML** maison (**pastille + libellé + %**) à droite du canvas, **sans légende** Chart.js ; mapping couleur **`SIGNAL_RANGE` / `TIMING_GAP` / `DUPLICATE` / autre** comme sur les spec jury.
- **État vide** : message **✅ No faults detected** lorsque aucune donnée avec **`count > 0`** (**`hasData`** faux).
- **`dashboard.component.ts`** : la carte « Fault Distribution » utilise **`<app-fault-donut-chart [data]="toFaultEntries(stats.faultsByType)" />`** ; ajout **`toFaultEntries`** et **import type `FaultEntry`** ; suppression de toute la logique donut inlined dans le dashboard (voir liste ci‑dessous dans **Problèmes** pour le delta).

## Ce que ça fait pour le projet

- **Isolation** du widget donut : même philosophie que **`MessageFrequencyChartComponent`** (**bar**) — le dashboard assemble des blocs KPI + graphiques sans centaines de lignes Chart.js dans un seul fichier.
- Alignement couleurs / pourcentages / tooltips donut **sans dupliquer** la logique côté parent.

## Comment — explication technique

1. **`initChart()`** déclenché après **`setTimeout(..., 50)`** depuis **`ngAfterViewInit`** pour laisser le **`@if (hasData())`** monter le **`canvas`**.
2. **`effect()`** : quand **`data()`** change (polling **30 s** du store), mise à jour **`labels`**, **`data`**, **`backgroundColor`** puis **`chart.update('none')`** si l’instance existe.
3. **`toFaultEntries(stats.faultsByType)`** transforme le **`Record<string, number>`** backend en **`FaultEntry[]`** attendu par l’enfant.

## Pourquoi — justification

- **Lisibilité soutenance** : donut **140×140**, **`cutout: '68%'`**, **tooltips** sombres cohérents avec le sniffer.
- **Réutilisabilité** : le composant peut être répliqué ailleurs (rapport, modal) sans **copier-coller** options Chart.js.

## Explication sans background informatique

Le camembert affiche **quelle part** des défauts appartient à chaque **type** (hors plage, retard, doublon…). Si **aucun** défaut avec volume **> 0**, un message vert confirme qu’**il n’y a rien à signaler**.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

Navigation : **`/admin`** avec données réelles ou fictives :

- donut + pourcentages + couleurs cohérentes ;
- base sans défauts → état vide **✅ No faults detected** ;
- aucune dépendance au **`totalFaults > 0`** du parent (**logique **`hasData()`** uniquement dans l’enfant**).

## Problèmes rencontrés et corrections appliquées

- **Refactor Dashboard** pour retirer le code donut dupliqué — **éléments effectivement retirés** du **`DashboardComponent`** :
  - imports **`chart.js`** et appel **`Chart.register(ArcElement, DoughnutController, Tooltip)`** ;
  - **`AfterViewInit`**, **`ElementRef`**, **`ViewChild`**, **`effect`** (Angular) ;
  - **`@ViewChild('faultChart')`**, champ **`chart: Chart<'doughnut'>"`**, couleurs **`FAULT_COLORS` / `OTHER_COLOR`** ;
  - **`constructor()`** avec **`effect` + `setTimeout` → `updateChart`** ;
  - **`ngAfterViewInit()`** ;
  - méthodes **`updateChart()`**, **`faultEntries()`**, **`faultColor()`**, **`faultPct()`**, **`objectKeys()`** ;
  - template inlined (`canvas`, boucle **`@for`**, branches **`stats.totalFaults`**).
- **Conservés** sur le dashboard : **`OnInit`**, **`ngOnInit`**, **polling **`interval`** + **`takeUntilDestroyed`**, **`goTo`**, **`openSession`**, **`formatDate`**, **`toFaultEntries`**.
- À noter : le commentaire fichier enfant **`// ... already registered in dashboard.component.ts`** reflète désormais l’historique (**enregistrement effectif** dans **`FaultDonutChartComponent`** + éventuelle déduplication Chart.js lors du lazy-load du même chunk).

## Mots clés pour la soutenance

**FaultDonutChartComponent**, **doughnut Chart.js**, **`FaultEntry`**, **`hasData`**, **`computed`**, **`effect()`**, **labels HTML**, **`cutout: '68%'`**, **`chart.update('none')`**, **refonte dashboard**, **séparation des responsabilités**.
