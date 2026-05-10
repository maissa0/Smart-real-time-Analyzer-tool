# Chart.js — migration CDN vers bundle local

## Ce qui a été fait

- **`Frontend_angular/src/app/features/sniffer/sniffer.component.ts`** : la méthode **`loadChartJs()`** ne charge plus Chart.js via **`document.createElement('script')`** et l’URL **`cdn.jsdelivr.net`** ; le chargement est considéré comme **immédiat** car la librairie est **fournie par le bundle** (`chart.js` depuis **`node_modules`**). Le signal **`chartJsLoaded`** est passé à **`true`** pour garder le comportement de l’onglet **Charts** (template **`@if (chartJsLoaded())`**).
- **`Frontend_angular/src/app/features/sniffer/signal-chart/signal-chart.component.ts`** :
  - Imports modulaires depuis **`chart.js`** : **`Chart`**, **`LineController`**, **`LineElement`**, **`PointElement`**, **`LinearScale`**, **`Filler`**, **`Tooltip`** ;
  - **`Chart.register(...)`** au niveau du module (équivalent léger par rapport au CDN UMD) ;
  - **`getChartJs()`** retourne désormais **`Chart`** importé au lieu de **`(window as any)['Chart']`**.
- **`ng build --configuration development`** : **Application bundle generation complete** (vérifié).
- Vérification **`cdn.jsdelivr`** sous **`Frontend_angular/src`** : **aucune occurrence** (après recherche récursive sur les fichiers).

## Ce que ça fait pour le projet

- L’outil **Sniffer / onglet graphiques signaux** ne dépend plus d’un **téléchargement réseau** au moment où l’utilisateur ouvre l’onglet : utile lors d’une **soutenance**, **réseau filtré** ou **hors ligne**.
- Une seule stratégie d’intégration Chart.js avec le **dashboard** (doughnut) : tous les usages passent par **`npm`** et le bundler Angular.

## Comment — explication technique

1. Le **CDN UMD** exposait **`window.Chart`** ; le **`signal-chart`** instanciait **`new Chart(ctx, { type: 'line', ... })`**. Les contrôleurs / éléments nécessaires ne sont plus enregistrés globalement par un script CDN : ils sont **`Chart.register(...)`** depuis le fichier du composant, ce qui correspond au **treeshaking Chart.js v4**.
2. **`dashboard.component.ts`** continue d’enregistrer **`ArcElement`** et **`DoughnutController`** pour le donut ; **`signal-chart.component.ts`** enregistre **`LineController`**, **`LineElement`**, **`PointElement`**, **`LinearScale`**, **`Filler`**, **`Tooltip`** pour les mini-graphiques ligne — **sans doublon inutile** sur les parties non utilisées.
3. **`loadChartJs()`** reste synchrone (**`(): void`**), ce qui évite de refactor tout l’appelant ; l’« ancien » flux **onload script** devient un **noop** côté réseau.

## Pourquoi — justification

- **Fiabilité** : pas de point de défaillance DNS / pare-feu / proxy pour **`jsdelivr`** au runtime.
- **Sécurité / conformité** : dépendances **verrouillées** dans **`package-lock.json`** (version **`chart.js`** fixée dans le projet).
- **Performances prévisibles** : Chart.js fait partie du **lazy chunk** sniffer lorsque la route est chargée, au lieu d’une deuxième étape réseau.

## Explication sans background informatique

Avant, l’application **téléchargeait une librairie de graphiques depuis Internet** quand vous ouvriez l’écran qui affiche les courbes CAN : si la salle ou le réseau **bloque** ce téléchargement, les graphiques ne s’affichent pas. Maintenant, la même librairie est **livérée avec l’application** au moment où le site est construit : elle **fonctionne même sans accès au CDN**.

## Comment tester manuellement

```powershell
cd C:/tools/Kpit_c/Frontend_angular
npx ng build --configuration development 2>&1 | Select-Object -Last 8
```

Puis dans le navigateur (connecté avec un fichier ou session dispose de données trace) :

1. Aller dans **CAN Sniffer** → onglet **Charts**.
2. Vérifier que les **mini-graphiques ligne** apparaissent **sans erreur réseau** vers **`cdn.jsdelivr.net`** dans l’onglet **Network** du navigateur.
3. (Optionnel) couper Internet et recharger : l’onglet Charts doit toujours se comporter comme avant tant que **`ng serve`/build est local**.

### Vérification sans CDN sous `Frontend_angular/src`

```powershell
cd C:/tools/Kpit_c
Get-ChildItem Frontend_angular/src -Recurse -File | Select-String -Pattern "cdn.jsdelivr"
```

Sortie attendue : **vide** (aucune ligne).

## Problèmes rencontrés et corrections appliquées

- **PowerShell (`Select-String -Recurse`)** : suivant la version, **`-Recurse`** n’est pas accepté comme sur l’invocation utilisateur ; équivalent utilisé **`Get-ChildItem ... -Recurse -File | Select-String`** pour la recherche **CDN**.
- **Signal `chartJsLoaded`** : le texte demandé pour le corps de **`loadChartJs()`** ne comportait pas explicitement **`this.chartJsLoaded.set(true)`**. Sans cette ligne, le template resterait sur l’état **« loading »** alors que Chart.js est déjà disponible — **`set(true)`** a été **conservé** pour corriger ce gap fonctionnel tout en supprimant le CDN (équivalent à l’**`onload`** du script injecté).
- **Signature `void` vs `return Promise.resolve()`** : en TypeScript, **`return Promise.resolve()`** n’est pas admissible dans une fonction déclarée **`void`** ; le comportement **« résolution immédiate »** est obtenu par **absence de chargement async** + **`set(true)`** synchrone.

## Mots clés pour la soutenance

**Chart.js v4**, **treeshaking**, **`Chart.register`**, **bundle npm**, **offline-first**, **suppression CDN**, **`LineController`** / **`DoughnutController`**, **`window.Chart`**, **KPIT CAN Sniffer**, **`chartJsLoaded`**, **Angular lazy routes**.
