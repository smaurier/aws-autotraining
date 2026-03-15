# 14 — CloudWatch & X-Ray — Observabilite

> **Duree estimee** : 5h00
> **Difficulte** : 3/5
> **Prerequis** : Module 05 (Lambda), Module 11 (ECS), notions de logging
> **Objectifs** :
> - Comprendre les **metriques CloudWatch** (standard, custom, haute resolution)
> - Creer des **alarmes** (seuil, anomalie, composite)
> - Analyser les **logs** avec CloudWatch Logs et **Logs Insights**
> - Construire des **dashboards** de monitoring
> - Tracer les requetes distribuees avec **X-Ray**
> - Mettre en place des **Synthetics canaries** pour le monitoring proactif

---

## Pourquoi l'observabilite ?

### Les trois piliers

L'observabilite repose sur trois piliers complementaires :

| Pilier | Question | Outil AWS |
|--------|----------|-----------|
| **Metriques** | "Combien ?" (CPU, requetes/s, erreurs) | CloudWatch Metrics |
| **Logs** | "Que s'est-il passe ?" (details des evenements) | CloudWatch Logs |
| **Traces** | "Ou est le probleme ?" (parcours d'une requete) | X-Ray |

Imaginez un restaurant :
- **Metriques** : "En moyenne, un plat est servi en 12 minutes" (indicateurs)
- **Logs** : "A 19h32, la commande #45 a ete preparee par le chef Paul" (details)
- **Traces** : "La commande #45 a pris 3 min en cuisine, 2 min en attente, 1 min de service" (parcours)

---

## CloudWatch Metrics

### Qu'est-ce qu'une metrique ?

Une **metrique** est une serie temporelle de points de donnees. Chaque point a :
- Un **timestamp** (quand)
- Une **valeur** (combien)
- Une **unite** (octets, secondes, nombre...)

### Metriques standard

AWS envoie automatiquement des metriques pour ses services. Voici les plus importantes :

#### EC2
| Metrique | Description | Granularite |
|----------|-------------|-------------|
| `CPUUtilization` | % de CPU utilise | 5 min (basic) / 1 min (detailed) |
| `NetworkIn/Out` | Octets reseau | 5 min |
| `StatusCheckFailed` | Probleme de l'instance | 1 min |

**Attention** : EC2 ne reporte **pas** l'utilisation memoire ni l'espace disque. Pour cela, il faut installer le **CloudWatch Agent**.

#### Lambda
| Metrique | Description |
|----------|-------------|
| `Invocations` | Nombre d'appels |
| `Duration` | Temps d'execution (ms) |
| `Errors` | Nombre d'erreurs |
| `Throttles` | Requetes limitees |
| `ConcurrentExecutions` | Executions simultanees |

#### ALB
| Metrique | Description |
|----------|-------------|
| `RequestCount` | Nombre de requetes |
| `TargetResponseTime` | Latence moyenne |
| `HTTPCode_Target_5XX_Count` | Erreurs serveur |
| `HealthyHostCount` | Instances saines |

### Namespaces et dimensions

Les metriques sont organisees en **namespaces** (ex : `AWS/Lambda`, `AWS/EC2`) et filtrees par **dimensions** :

```
Namespace: AWS/Lambda
  Metrique: Duration
  Dimensions:
    FunctionName = "process-order"
    Resource = "process-order:PROD"
```

Les dimensions permettent de filtrer — par exemple, voir la duree uniquement pour une fonction Lambda specifique.

### Metriques custom

Vous pouvez envoyer vos propres metriques a CloudWatch :

```typescript
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cw = new CloudWatch({});

await cw.putMetricData({
  Namespace: 'MonApp/Commandes',
  MetricData: [
    {
      MetricName: 'CommandesTraitees',
      Value: 1,
      Unit: 'Count',
      Dimensions: [
        { Name: 'Environnement', Value: 'production' },
        { Name: 'Region', Value: 'eu-west-1' }
      ]
    }
  ]
});
```

### Metriques haute resolution

Par defaut, les metriques custom ont une granularite de **1 minute**. Pour des cas critiques, vous pouvez envoyer des metriques **haute resolution** avec une granularite de **1 seconde** :

```typescript
{
  MetricName: 'LatenceAPI',
  Value: 42.5,
  Unit: 'Milliseconds',
  StorageResolution: 1  // 1 seconde au lieu de 60
}
```

**Attention** : les metriques haute resolution coutent plus cher. Reservez-les aux cas ou la seconde compte (trading, gaming temps reel).

### Periodes et statistiques

Quand vous consultez une metrique, vous choisissez :
- **Periode** : l'intervalle de temps pour chaque point (60s, 300s, 3600s...)
- **Statistique** : comment agreger les valeurs

| Statistique | Description | Cas d'usage |
|-------------|-------------|-------------|
| `Average` | Moyenne | CPU, latence typique |
| `Sum` | Somme | Nombre de requetes, erreurs |
| `Minimum` | Valeur min | Meilleur temps de reponse |
| `Maximum` | Valeur max | Pic de latence |
| `p50, p90, p99` | Percentiles | Latence : "99% des requetes < X ms" |
| `SampleCount` | Nombre de points | Volume de donnees |

**Bonne pratique** : pour la latence, utilisez **p99** plutot que la moyenne. La moyenne masque les pics qui affectent les utilisateurs.

---

## CloudWatch Alarms

### Types d'alarmes

#### 1. Alarme a seuil (Threshold)

La plus simple : declenche quand une metrique depasse un seuil pendant N periodes.

```
Alarme : "CPU Eleve"
  Metrique : CPUUtilization
  Condition : > 80%
  Periodes : 3 periodes consecutives de 5 minutes
  Action : Envoyer SNS → email
```

**Etats d'une alarme** :
- `OK` : la metrique est sous le seuil
- `ALARM` : la metrique depasse le seuil
- `INSUFFICIENT_DATA` : pas assez de donnees pour evaluer

#### 2. Alarme anomalie (Anomaly Detection)

CloudWatch apprend le **comportement normal** de votre metrique et alerte quand la valeur sort de la bande attendue.

```
Bande normale de CPUUtilization (apprise sur 2 semaines) :
  Lundi 9h : 40-60% (heure de pointe attendue)
  Dimanche 3h : 5-15% (creux attendu)

→ Si CPU = 70% le dimanche a 3h → ALARME (anormal)
→ Si CPU = 55% le lundi a 9h → OK (normal)
```

**Cas d'usage** : metriques avec des patterns saisonniers (jour/nuit, semaine/weekend).

#### 3. Alarme composite

Combine **plusieurs alarmes** avec des operateurs logiques (AND, OR, NOT) :

```
Alarme composite : "Probleme Critique"
  = AlarmeCPU AND AlarmeErreurs5xx AND NOT AlarmeMaintenance
```

Cela evite les faux positifs — par exemple, ne pas alerter pendant une maintenance planifiee.

### Actions d'alarme

Quand une alarme se declenche, elle peut :
- Envoyer une **notification SNS** (email, SMS, Slack via Lambda)
- Executer une **action Auto Scaling** (ajouter/retirer des instances)
- Executer une **action EC2** (stop, terminate, reboot)
- Creer un **incident** dans Systems Manager

---

## CloudWatch Logs

### Architecture des logs

```
Application → Log Stream → Log Group → CloudWatch Logs
```

| Concept | Description | Exemple |
|---------|-------------|---------|
| **Log Event** | Une seule entree de log | `2024-01-15 ERROR: Connection refused` |
| **Log Stream** | Sequence d'events d'une meme source | Logs d'une instance EC2 specifique |
| **Log Group** | Collection de streams du meme type | `/aws/lambda/process-order` |

### Retention

Par defaut, les logs sont conserves **indefiniment** (et coutent de l'espace). Configurez toujours une retention :

| Retention | Cas d'usage |
|-----------|-------------|
| 1 jour | Developpement |
| 7 jours | Staging |
| 30 jours | Production (logs applicatifs) |
| 90 jours | Audit |
| 1 an+ | Compliance reglementaire |

### Metric Filters

Les **metric filters** transforment des patterns de logs en metriques CloudWatch :

```
Log Group : /aws/lambda/process-order
Filter Pattern : "ERROR"
Metrique : MonApp/Erreurs (increment de 1 a chaque match)
```

Patterns de filtre courants :

```
"ERROR"                          → contient le mot ERROR
[ip, user, timestamp, request, status_code = 5*, bytes]  → status 5xx
{ $.level = "error" }            → JSON avec champ level = error
{ $.duration > 3000 }            → JSON avec duration > 3 secondes
```

### CloudWatch Logs Insights

**Logs Insights** est un langage de requete puissant pour analyser les logs. Il permet de chercher, filtrer et agreger les logs en quelques secondes.

#### Syntaxe de base

```sql
-- Les 20 derniers logs d'erreur
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 20
```

#### Requetes avancees

```sql
-- Top 10 des erreurs les plus frequentes
fields @message
| filter @message like /ERROR/
| stats count(*) as nb by @message
| sort nb desc
| limit 10
```

```sql
-- Latence moyenne par endpoint (logs JSON)
fields @timestamp, endpoint, duration
| filter ispresent(endpoint)
| stats avg(duration) as latence_moy,
        max(duration) as latence_max,
        count(*) as nb_requetes
  by endpoint
| sort latence_moy desc
```

```sql
-- Percentile 99 de la duree Lambda par heure
fields @timestamp, @duration
| stats pct(@duration, 99) as p99 by bin(1h)
| sort @timestamp
```

#### Visualisation

Les resultats de Logs Insights peuvent etre affiches sous forme de :
- Tableau
- Graphique en courbes (time series)
- Graphique en barres

Et peuvent etre ajoutes directement a un **dashboard CloudWatch**.

---

## CloudWatch Dashboards

### Creer un dashboard

Un dashboard est un ensemble de **widgets** affichant des metriques, logs et alarmes sur une seule page.

### Types de widgets

| Widget | Description | Cas d'usage |
|--------|-------------|-------------|
| **Line** | Courbe temporelle | CPU, latence au fil du temps |
| **Stacked area** | Aires empilees | Repartition des erreurs par type |
| **Number** | Valeur unique | Nombre total de requetes |
| **Gauge** | Jauge | Pourcentage d'utilisation |
| **Bar** | Barres | Comparaison entre services |
| **Text** | Texte Markdown | Titres, descriptions, liens |
| **Alarm** | Etat des alarmes | Vue d'ensemble rouge/vert |
| **Logs** | Requete Logs Insights | Derniers logs d'erreur |

### Dashboard operationnel type

```
┌─────────────────────────────────────────────┐
│ 🟢 Mon Application - Dashboard Production    │
├──────────────┬──────────────┬───────────────┤
│ Requetes/min │  Latence p99 │  Taux erreur  │
│    1,247     │    142ms     │    0.3%       │
├──────────────┴──────────────┴───────────────┤
│ [Graphe] Requetes et erreurs (derniere heure) │
├─────────────────────┬───────────────────────┤
│ [Graphe] CPU Lambda │ [Graphe] DynamoDB RCU │
├─────────────────────┴───────────────────────┤
│ [Alarmes] Etat de toutes les alarmes        │
├─────────────────────────────────────────────┤
│ [Logs] 10 dernieres erreurs                 │
└─────────────────────────────────────────────┘
```

### Cout

- Les **3 premiers dashboards** (max 50 metriques chacun) sont **gratuits**
- Au-dela : $3.00/mois par dashboard

---

## AWS X-Ray

### Le probleme du tracing distribue

Dans une architecture microservices, une seule requete utilisateur peut traverser de nombreux services :

```
Client → API Gateway → Lambda A → DynamoDB
                          ↓
                      SQS Queue → Lambda B → SNS
                                     ↓
                                  DynamoDB
```

Si cette requete est lente ou echoue, **ou est le probleme ?** Les logs seuls ne suffisent pas car chaque service a ses propres logs. X-Ray permet de voir le **parcours complet** d'une requete.

### Concepts X-Ray

| Concept | Description |
|---------|-------------|
| **Trace** | Le parcours complet d'une requete, de bout en bout |
| **Segment** | Le travail effectue par un service (ex : Lambda A) |
| **Subsegment** | Un detail dans un segment (ex : appel DynamoDB dans Lambda A) |
| **Trace ID** | Identifiant unique de la trace (propage entre services) |
| **Annotations** | Paires cle/valeur indexees (pour filtrer) |
| **Metadata** | Donnees supplementaires non indexees |

### Comment ca fonctionne

```
1. Le premier service genere un Trace ID
2. Chaque service ajoute un segment avec ses informations
3. Le Trace ID est propage via le header X-Amzn-Trace-Id
4. X-Ray rassemble tous les segments pour reconstituer la trace
```

### X-Ray SDK avec Node.js

```typescript
import AWSXRay from 'aws-xray-sdk-core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Instrumenter le client AWS pour tracer les appels
const dynamodb = AWSXRay.captureAWSv3Client(
  new DynamoDBClient({})
);

// Creer un subsegment custom
const segment = AWSXRay.getSegment();
const subsegment = segment!.addNewSubsegment('process-payment');

try {
  // Logique metier
  await processPayment(order);

  // Ajouter des annotations (indexees, cherchables)
  subsegment.addAnnotation('orderId', order.id);
  subsegment.addAnnotation('amount', order.total);

  // Ajouter des metadata (non indexees)
  subsegment.addMetadata('orderDetails', order);

  subsegment.close();
} catch (err) {
  subsegment.addError(err as Error);
  subsegment.close();
  throw err;
}
```

### Annotations vs Metadata

| Critere | Annotations | Metadata |
|---------|------------|----------|
| Indexees | Oui (cherchables) | Non |
| Limite | 50 par trace | Pas de limite stricte |
| Filtrage | `annotation.orderId = "123"` | Non filtrable |
| Cas d'usage | IDs, statuts, types | Payloads, details |

### Activation X-Ray sur les services

| Service | Activation |
|---------|-----------|
| **Lambda** | Cocher "Active tracing" dans la config |
| **API Gateway** | Activer dans les settings du stage |
| **ECS** | Ajouter un sidecar X-Ray daemon |
| **EC2** | Installer le X-Ray daemon |
| **App Runner** | Active par defaut |

---

## Service Map

### Visualiser l'architecture

Le **Service Map** de X-Ray genere automatiquement un diagramme de votre architecture en temps reel :

```
    [API Gateway]
         |
    response: 200ms
    errors: 0.1%
         |
    [Lambda: process-order]
       /        \
      /          \
[DynamoDB]    [SQS Queue]
 45ms OK       12ms OK
                  |
            [Lambda: notify]
                  |
              [SNS Topic]
               8ms OK
```

Chaque noeud affiche :
- Le **nom du service**
- La **latence moyenne**
- Le **taux d'erreur** (colore en vert/jaune/rouge)
- Le **volume de requetes**

Le Service Map permet d'identifier rapidement les goulots d'etranglement et les services defaillants.

---

## Synthetics Canaries

### Monitoring proactif

Les **Synthetics canaries** sont des scripts automatises qui simulent des **parcours utilisateur** a intervalles reguliers. Ils detectent les problemes **avant** les vrais utilisateurs.

### Fonctionnement

```
CloudWatch Synthetics
       |
       v
Canary (Lambda + Puppeteer/Selenium)
       |
       v
Execute un script toutes les X minutes
       |
       ├── Verifie que la page d'accueil charge en < 3s
       ├── Verifie que le login fonctionne
       ├── Verifie que l'API retourne 200
       └── Prend des captures d'ecran
       |
       v
Resultat → Metrique CloudWatch → Alarme si echec
```

### Types de canaries

| Type | Description |
|------|-------------|
| **Heartbeat** | Verifie qu'une URL repond (simple ping) |
| **API** | Teste un endpoint API (status, body, latence) |
| **Broken Link Checker** | Verifie que tous les liens d'une page fonctionnent |
| **Visual** | Compare des captures d'ecran pour detecter les regressions visuelles |
| **Custom** | Script Node.js/Python personnalise |

### Exemple de canary API

```javascript
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const apiCanaryBlueprint = async function () {
  const response = await synthetics.executeHttpStep(
    'Verify API Health',
    {
      hostname: 'api.mon-site.com',
      method: 'GET',
      path: '/health',
      port: 443,
      protocol: 'https:'
    }
  );

  // Verifier le status code
  if (response.statusCode !== 200) {
    throw new Error(`Expected 200, got ${response.statusCode}`);
  }

  // Verifier le temps de reponse
  log.info(`Response time: ${response.timing.duration}ms`);
};

exports.handler = async () => {
  return await apiCanaryBlueprint();
};
```

### Frequence et cout

- Frequence minimale : **1 minute**
- Cout : ~$0.0012 par execution
- Un canary toutes les 5 minutes = ~$0.35/mois

---

## Container Insights

### Monitoring des containers

**Container Insights** est une fonctionnalite de CloudWatch specialisee pour les workloads conteneurisees (ECS, EKS, Kubernetes).

### Metriques collectees

| Niveau | Metriques |
|--------|-----------|
| **Cluster** | CPU, memoire, nombre de taches/pods |
| **Service** | CPU, memoire, nombre de taches par service |
| **Task/Pod** | CPU, memoire, reseau par tache/pod |
| **Container** | CPU, memoire par container individuel |

### Activation

Pour ECS Fargate, activez Container Insights au niveau du cluster :

```bash
aws ecs update-cluster-settings \
  --cluster mon-cluster \
  --settings name=containerInsights,value=enabled
```

### Metriques cles

```
CPU Utilization par service :
  - service-api: 45%
  - service-worker: 78%  ← potentiel probleme
  - service-web: 12%

Memoire par tache :
  - task-abc123: 256 Mo / 512 Mo (50%)
  - task-def456: 490 Mo / 512 Mo (96%)  ← risque OOM
```

Container Insights genere automatiquement des dashboards avec ces metriques.

---

## Bonnes pratiques

### Metriques
- Definissez des **metriques business** (commandes/min, revenus) en plus des metriques techniques
- Utilisez les **percentiles** (p99) plutot que les moyennes pour la latence
- Envoyez des metriques custom pour les indicateurs cles de votre application
- Gardez une granularite de **1 minute** sauf besoin reel de haute resolution

### Alarmes
- Configurez des alarmes sur les **metriques critiques** (erreurs 5xx, latence p99, DLQ)
- Utilisez les **alarmes composites** pour reduire les faux positifs
- Definissez des **runbooks** (procedures) pour chaque alarme
- Ne creez pas trop d'alarmes — la fatigue d'alerte mene a l'ignorance des alertes

### Logs
- Structurez vos logs en **JSON** pour faciliter l'analyse
- Configurez une **retention** adaptee (ne gardez pas les logs indefiniment)
- Utilisez les **metric filters** pour transformer les patterns importants en metriques
- Maitrisez **Logs Insights** pour le troubleshooting rapide

### Tracing
- Activez X-Ray sur **tous les services** de votre architecture
- Ajoutez des **annotations** pour les identifiants metier (orderId, userId)
- Consultez le **Service Map** regulierement pour comprendre les dependances
- Utilisez les traces pour identifier les **goulots d'etranglement**

---

## Recapitulatif

| Concept | A retenir |
|---------|-----------|
| **CloudWatch Metrics** | Series temporelles (standard + custom + haute resolution) |
| **Alarmes** | Seuil, anomalie, composite → actions (SNS, Auto Scaling) |
| **CloudWatch Logs** | Log Events → Streams → Groups, retention configurable |
| **Logs Insights** | Requetes SQL-like sur les logs (filtre, stats, visualisation) |
| **Metric Filters** | Transforment des patterns de logs en metriques |
| **Dashboards** | Vue unifiee des metriques, logs et alarmes |
| **X-Ray** | Tracing distribue (traces, segments, subsegments) |
| **Service Map** | Visualisation automatique de l'architecture et des latences |
| **Synthetics** | Tests automatises simulant les parcours utilisateur |
| **Container Insights** | Metriques detaillees pour ECS/EKS |
