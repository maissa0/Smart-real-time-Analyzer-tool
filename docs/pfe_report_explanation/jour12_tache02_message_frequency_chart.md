# MessageFrequencyChartComponent — Top Message IDs bar chart

## Ce qui a été fait

- Création du dossier **`Frontend_angular/src/app/features/dashboard/message-frequency-chart/`** et du composant **`message-frequency-chart.component.ts`** (**standalone**, **`OnPush`**).
- **Chart.js** : enregistrement modulaire **`BarController`**, **`BarElement`**, **`CategoryScale`**, **`LinearScale`**, **`Tooltip`** puis graphique **`type: 'bar'`** avec couleurs **KPIT** (**`rgba(176,255,68,0.70)`**, survol **`#b0ff44`**), grille Y légère, axe X en **monospace**.
- **`input()`** signal **`data`** (**`MsgFrequency[]`**) ; **`effect()`** dans le constructeur pour mettre à jour **`labels`** / **`data`** et **`chart.update('none')`** lors du rafraîchissement (polling dashboard 30 s) sans réinitialiser tout le graphe ; **`destroy()`** dans **`ngOnDestroy`**.
- **`dashboard.component.ts`** : import **`MessageFrequencyChartComponent`**, ajout aux **`imports`**, remplacement de la carte **Top Message IDs** (barres HTML) par **`<app-message-frequency-chart [data]="stats.topMessageIds" />`** avec état vide **« No frames yet »** ; suppression de la méthode **`barWidth()`** devenue inutile.

## Ce que ça fait pour le projet

- Le dashboard affiche les **5 message IDs les plus fréquents** sous forme de **histogramme** homogène avec le **donut** des défauts et la charte **KPIT** (**vert brand**).
- Lecture plus **rapide en soutenance** (échelles, format **k** sur l’axe Y, tooltips formatés en **frames**).

## Comment — explication technique

1. Les stats proviennent toujours de **`DashboardStore`** / **`GET /api/dashboard/stats`** (`topMessageIds`).
2. Le composant enfant isole la logique **Chart.js bar** : **`ngAfterViewInit`** appelle **`initChart()`** une fois le **`canvas`** disponible ; l’**`effect`** réagit aux changements du **signal input** sans recréer l’instance **`Chart`** à chaque tick.
3. **`maintainAspectRatio: false`** + conteneur **`height: 250px`** pour un rendu stable dans la grille **two-column** du dashboard.

## Pourquoi — justification

- **Réutilisation** et **séparation** : le dashboard garde KPI + donut sans alourdir le template avec du markup-barre manuel.
- **Cohérence** Chart.js **npm** (hors CDN) avec le sniffer ligne et le dashboard donut.
- **`update('none')`** : évite les animations parasite lors du **polling 30 s**.

## Explication sans background informatique

Les **identifiants de messages CAN** les plus présents dans la base s’affichent comme des **barres vertes** : plus la barre est haute, plus ce message est **répété**. En passant la souris, une info-bulle indique **combien de trames** correspondent à ce message.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

Puis : se connecter → **`/admin`** → vérifier la section **Top Message IDs** (barres + tooltips) ; avec une base vide, le texte **No frames yet** doit s’afficher.

## Problèmes rencontrés et corrections appliquées

- Aucun blocage de compilation : **`ng build`** (**development**) s’est terminé avec **Application bundle generation complete** après intégration du composant et retrait de **`barWidth()`**.

## Mots clés pour la soutenance

**MessageFrequencyChartComponent**, **Chart.js bar chart**, **`BarController`**, **`CategoryScale`**, **signal `input()`**, **`effect()`**, **`chart.update('none')`**, **KPIT green `#b0ff44`**, **Top Message IDs**, **dashboard polling**, **standalone Angular**.
