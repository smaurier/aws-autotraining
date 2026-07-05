# Lab 16 — Assembler une archi serverless orchestrée (Step Functions)

> **Outcome :** à la fin, tu sais déployer une **vraie** state machine Step Functions **Standard** dans ton compte AWS, l'invoquer réellement, observer le graphe d'exécution étape par étape, et **prouver l'idempotence** (un rejeu avec la même clé ne double pas la donnée) grâce à un `Catch` sur une écriture conditionnelle DynamoDB.
> **Vrai outil :** AWS CLI + Console Step Functions (Workflow Studio + vue d'exécution) + DynamoDB + SNS + IAM. **Aucun harnais simulé** — tu touches le vrai service, tu paies (presque rien), tu détruis.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur. Le critère de réussite est **observable dans la console AWS** (graphe vert, event history, item DynamoDB).

---

## Rappel Free Tier & coût (à lire AVANT de déployer)

Ce lab reste dans le **Free Tier** si tu respectes le teardown :

- **Step Functions Standard** : 4 000 transitions d'état gratuites par mois (Free Tier permanent). Le workflow ci-dessous fait ~6 transitions par exécution → tu peux le lancer des centaines de fois sans frais.
- **DynamoDB** : table **on-demand**, 25 Go de stockage gratuits — quelques items = 0 €.
- **SNS** : le premier million de publications par mois est gratuit.
- **IAM** : gratuit.

Coût réel attendu de ce lab : **~0,00 €**. Le seul risque de facturation, c'est **d'oublier de détruire** — d'où la section **Teardown obligatoire** en fin de lab, non négociable.

> Région utilisée partout : `eu-west-1`. Remplace `123456789012` par ton **account ID** réel (`aws sts get-caller-identity --query Account --output text`).

---

## Énoncé

Tu montes l'infra AWS de TribuZen. Un parent poste une photo dans le bucket avatars. Tu dois transformer la **Lambda monolithique** du module 16 (§1) en une **orchestration Step Functions** : chaque étape isolée, un `Retry` ciblé, un `Catch` qui gère l'idempotence, une compensation en cas d'échec réel.

Pour rester léger et 100 % Free Tier, tu n'écris **aucune Lambda** : tu utilises les **intégrations directes** (SDK integrations) de Step Functions vers DynamoDB et SNS (module 16, §2.7). Les étapes « valider » et « générer la miniature » sont modélisées par des états de flux (`Choice`, `Pass`) — l'objectif du lab est l'**orchestration et l'idempotence**, pas le traitement d'image.

Le workflow à assembler :

```
ValidateSize (Choice)
   ├─ fichier > 5 Mo  → RejectUpload (Fail)
   └─ sinon           → GenerateThumbnail (Pass, simule l'étape)
                            → WriteFeed (Task: dynamodb:putItem, ConditionExpression)
                                 ├─ OK                              → NotifyFamily (Task: sns:publish) → Success
                                 ├─ ConditionalCheckFailed (rejeu) → AlreadyProcessed (Pass) → Success  [idempotence]
                                 └─ toute autre erreur              → CompensateAndFail (Pass) → Fail    [saga]
```

Le cœur pédagogique : la première exécution avec un `uploadId` **écrit** dans le feed. La **deuxième** exécution avec le **même** `uploadId` déclenche `ConditionalCheckFailedException` → le `Catch` route vers `AlreadyProcessed` → **succès sans doublon**. C'est l'idempotence du module 16 (§2.9), en vrai, observable dans la console.

**Pas de gap-fill.** Tu écris l'ASL complète à partir du starter, tu crées les ressources, tu invoques, tu observes.

### Starter minimal

Table DynamoDB + topic SNS + rôle IAM à créer une fois (CLI ci-dessous, section Étapes). L'ASL de départ que tu dois **compléter** :

```json
{
  "Comment": "TribuZen lab 16 — orchestration upload avatar (a completer)",
  "StartAt": "ValidateSize",
  "States": {
    "ValidateSize": {
      "Type": "Choice",
      "Choices": [],
      "Default": "GenerateThumbnail"
    }
  }
}
```

À toi d'ajouter : la règle `Choice` (rejet si trop lourd), `GenerateThumbnail` (`Pass`), `WriteFeed` (`Task` `dynamodb:putItem` avec `ConditionExpression`, `Retry` + deux `Catch`), `AlreadyProcessed`, `CompensateAndFail`, `NotifyFamily`, `RejectUpload`, `Success`.

---

## Étapes (en friction)

Tu produis chaque commande / bloc ASL toi-même. Les commandes de création sont fournies (setup), l'**ASL est à écrire**.

1. **Prépare les identifiants.**
   ```bash
   aws sts get-caller-identity --query Account --output text
   ```
   Note ton account ID. Toutes les commandes ci-dessous utilisent `eu-west-1`.

2. **Crée la table DynamoDB** (on-demand → Free Tier, pas de capacité à provisionner) :
   ```bash
   aws dynamodb create-table \
     --table-name TribuZenFeed \
     --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
     --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
     --billing-mode PAY_PER_REQUEST \
     --region eu-west-1
   ```

3. **Crée le topic SNS** (note l'ARN retourné) :
   ```bash
   aws sns create-topic --name tribuzen-notify --region eu-west-1
   ```

4. **Crée le rôle IAM** que la state machine assumera. Écris `trust.json` :
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Service": "states.amazonaws.com" },
       "Action": "sts:AssumeRole"
     }]
   }
   ```
   Puis :
   ```bash
   aws iam create-role \
     --role-name TribuZenAvatarWorkflowRole \
     --assume-role-policy-document file://trust.json
   ```
   Attache une policy de **moindre privilège** (module 01) — écris `perms.json` en remplaçant l'account ID et l'ARN du topic :
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "dynamodb:PutItem",
         "Resource": "arn:aws:dynamodb:eu-west-1:123456789012:table/TribuZenFeed" },
       { "Effect": "Allow", "Action": "sns:Publish",
         "Resource": "arn:aws:sns:eu-west-1:123456789012:tribuzen-notify" }
     ]
   }
   ```
   ```bash
   aws iam put-role-policy \
     --role-name TribuZenAvatarWorkflowRole \
     --policy-name TribuZenAvatarWorkflowPolicy \
     --policy-document file://perms.json
   ```

5. **Écris l'ASL complète** dans `avatar-workflow.asl.json` (c'est le vrai travail — voir corrigé). Points de friction :
   - la règle `Choice` : `NumericGreaterThan` sur `$.sizeBytes` avec seuil `5242880` → `RejectUpload`.
   - `WriteFeed` : `Resource: arn:aws:states:::dynamodb:putItem`, `Parameters` avec `ConditionExpression: attribute_not_exists(sk)`, et **l'ordre Retry puis deux Catch**.
   - le premier `Catch` cible **précisément** `DynamoDB.ConditionalCheckFailedException` → `AlreadyProcessed` (idempotence), le second cible `States.ALL` → `CompensateAndFail` (saga).

6. **Crée la state machine** (type **Standard**, immuable — module 16 §2.8) :
   ```bash
   aws stepfunctions create-state-machine \
     --name TribuZenAvatarWorkflow \
     --type STANDARD \
     --role-arn arn:aws:iam::123456789012:role/TribuZenAvatarWorkflowRole \
     --definition file://avatar-workflow.asl.json \
     --region eu-west-1
   ```
   Note le `stateMachineArn` retourné.

7. **Invoque une première fois** (upload valide, `uploadId` unique) :
   ```bash
   aws stepfunctions start-execution \
     --state-machine-arn arn:aws:states:eu-west-1:123456789012:stateMachine:TribuZenAvatarWorkflow \
     --name run-upload-001 \
     --input '{"familyId":"fam-42","uploadId":"up-001","sizeBytes":1048576}' \
     --region eu-west-1
   ```
   Vérifie le résultat :
   ```bash
   aws stepfunctions describe-execution --execution-arn <ARN_retourne> --region eu-west-1
   ```
   Statut attendu : `SUCCEEDED`. Confirme l'item dans DynamoDB :
   ```bash
   aws dynamodb get-item --table-name TribuZenFeed \
     --key '{"pk":{"S":"fam-42"},"sk":{"S":"up-001"}}' --region eu-west-1
   ```

8. **Observe dans la Console.** Ouvre Step Functions → `TribuZenAvatarWorkflow` → l'exécution `run-upload-001`. Regarde le **Graph view** (chemin vert), puis le **Event view** : repère `TaskStateEntered` sur `WriteFeed` et sa sortie. C'est la visibilité par étape que la Lambda monolithique n'offrait pas.

9. **FORCE l'idempotence — le moment clé.** Relance avec le **même `uploadId`** :
   ```bash
   aws stepfunctions start-execution \
     --state-machine-arn arn:aws:states:eu-west-1:123456789012:stateMachine:TribuZenAvatarWorkflow \
     --name run-upload-001-replay \
     --input '{"familyId":"fam-42","uploadId":"up-001","sizeBytes":1048576}' \
     --region eu-west-1
   ```
   Dans la console, ouvre cette exécution : `WriteFeed` lève `DynamoDB.ConditionalCheckFailedException`, le `Catch` la route vers `AlreadyProcessed`, l'exécution finit **`SUCCEEDED`** — **et il n'y a toujours qu'un seul item** dans DynamoDB. Tu viens de voir l'idempotence empêcher un doublon, en vrai.

10. **Vérifie le rejet.** Relance avec un fichier trop lourd → le `Choice` route vers `RejectUpload`, exécution **`FAILED`** avec `Error: ValidationError` :
    ```bash
    aws stepfunctions start-execution \
      --state-machine-arn arn:aws:states:eu-west-1:123456789012:stateMachine:TribuZenAvatarWorkflow \
      --name run-toolarge \
      --input '{"familyId":"fam-42","uploadId":"up-999","sizeBytes":9000000}' \
      --region eu-west-1
    ```

11. **Lis l'historique en CLI** (sans la console) pour t'entraîner au débogage headless :
    ```bash
    aws stepfunctions get-execution-history --execution-arn <ARN_replay> \
      --query 'events[].type' --region eu-west-1
    ```

12. **Détruis tout.** Va directement à la section **Teardown obligatoire** ci-dessous. Ne saute pas cette étape.

---

## Corrigé complet commenté

`avatar-workflow.asl.json` (remplace `123456789012` par ton account ID) :

```json
{
  "Comment": "TribuZen lab 16 — orchestration d'un upload d'avatar (Standard)",
  "StartAt": "ValidateSize",
  "States": {

    "ValidateSize": {
      "Type": "Choice",
      "Comment": "Etape 1 (validation) modelisee par un Choice sur la taille",
      "Choices": [
        {
          "Variable": "$.sizeBytes",
          "NumericGreaterThan": 5242880,
          "Next": "RejectUpload"
        }
      ],
      "Default": "GenerateThumbnail"
    },

    "GenerateThumbnail": {
      "Type": "Pass",
      "Comment": "Etape 2 (miniature) simulee par un Pass — en prod = Task Lambda avec Retry",
      "Result": { "thumbnailKey": "thumbnails/generated.png" },
      "ResultPath": "$.thumbnail",
      "Next": "WriteFeed"
    },

    "WriteFeed": {
      "Type": "Task",
      "Comment": "Etape 3 : ecriture idempotente via integration directe DynamoDB",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "TribuZenFeed",
        "Item": {
          "pk":        { "S.$": "$.familyId" },
          "sk":        { "S.$": "$.uploadId" },
          "type":      { "S": "AVATAR_UPDATED" },
          "createdAt": { "S.$": "$$.State.EnteredTime" }
        },
        "ConditionExpression": "attribute_not_exists(sk)"
      },
      "Retry": [
        {
          "ErrorEquals": ["DynamoDB.InternalServerError", "States.Timeout"],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2.0
        }
      ],
      "Catch": [
        {
          "ErrorEquals": ["DynamoDB.ConditionalCheckFailedException"],
          "Next": "AlreadyProcessed"
        },
        {
          "ErrorEquals": ["States.ALL"],
          "Next": "CompensateAndFail"
        }
      ],
      "ResultPath": "$.writeResult",
      "Next": "NotifyFamily"
    },

    "AlreadyProcessed": {
      "Type": "Pass",
      "Comment": "Idempotence : le rejeu du meme uploadId est un no-op, PAS un echec",
      "Result": { "idempotent": true },
      "ResultPath": "$.note",
      "Next": "Success"
    },

    "CompensateAndFail": {
      "Type": "Pass",
      "Comment": "Saga : en prod, on supprimerait ici la miniature orpheline avant de finir",
      "Next": "Fail"
    },

    "NotifyFamily": {
      "Type": "Task",
      "Comment": "Etape 4 : notification via integration directe SNS",
      "Resource": "arn:aws:states:::sns:publish",
      "Parameters": {
        "TopicArn": "arn:aws:sns:eu-west-1:123456789012:tribuzen-notify",
        "Message.$": "$.familyId"
      },
      "Next": "Success"
    },

    "RejectUpload": {
      "Type": "Fail",
      "Error": "ValidationError",
      "Cause": "Fichier refuse (taille > 5 Mo)"
    },

    "Fail": {
      "Type": "Fail",
      "Error": "AvatarWorkflowFailed"
    },

    "Success": {
      "Type": "Succeed"
    }
  }
}
```

**Pourquoi ce corrigé est correct :**

- **`Choice` avant tout travail** — on rejette un fichier trop lourd sans avoir rien écrit. `NumericGreaterThan` compare `$.sizeBytes` (entrée du workflow) au seuil 5 Mo (`5242880`).
- **`GenerateThumbnail` est un `Pass`** — il représente l'étape sans en faire le travail réel. `ResultPath: "$.thumbnail"` **enrichit** l'entrée au lieu de l'écraser : `$.familyId` et `$.uploadId` restent disponibles pour la suite. C'est le piège classique — un `Pass` sans `ResultPath` remplace tout le contexte.
- **`WriteFeed` est le cœur.** `ConditionExpression: attribute_not_exists(sk)` rend l'écriture idempotente : un `uploadId` déjà présent lève `DynamoDB.ConditionalCheckFailedException`.
- **L'ordre `Retry` puis `Catch` compte.** Step Functions évalue `Retry` d'abord. On ne retente **que** les erreurs transitoires (`InternalServerError`, `Timeout`) — surtout pas la conditionnelle, qui ne réussira jamais au retry.
- **Deux `Catch`, du plus précis au plus large.** Le premier attrape `ConditionalCheckFailedException` → `AlreadyProcessed` : le rejeu est un **succès** (la donnée existe déjà), pas une erreur. Le second, `States.ALL`, est le filet de sécurité → `CompensateAndFail` (la saga du module 16 §2.10). Inverser l'ordre casserait tout : `States.ALL` matcherait en premier et l'idempotence ne serait jamais atteinte.
- **`$$.State.EnteredTime`** (double `$$`) lit le **contexte d'exécution**, pas l'entrée. Un seul `$` chercherait un champ `createdAt` dans l'input, qui n'existe pas.
- **Type `STANDARD`** : exactly-once, état durable, historique 90 jours, actions ici non critiques mais on veut l'**auditabilité** et la vue console. Express n'aurait pas d'historique visuel et serait at-least-once (module 16 §2.8).

---

## Critères de réussite (observables, validés par le coach)

1. `describe-execution` de `run-upload-001` retourne `SUCCEEDED`, et `get-item` retourne **un** item `fam-42 / up-001`.
2. Le **rejeu** (`run-upload-001-replay`) retourne **aussi** `SUCCEEDED`, passe par l'état `AlreadyProcessed` (visible dans le Event view), et DynamoDB contient **toujours un seul** item — zéro doublon.
3. L'exécution `run-toolarge` retourne `FAILED` avec `Error: ValidationError`, sans avoir rien écrit dans DynamoDB.
4. Tu sais **expliquer à voix haute** pourquoi le premier `Catch` doit précéder `States.ALL`, et pourquoi la conditionnelle n'est pas dans le `Retry`.
5. Le teardown est fait : `list-state-machines` ne renvoie plus `TribuZenAvatarWorkflow`, `describe-table` échoue, le topic et le rôle sont supprimés.

---

## Feedback coach (à faire en session)

Le coach ne lance pas de test-runner. Il te demande, écran partagé :

- **Montre le graphe** de l'exécution rejeu : « où voit-on que l'idempotence a agi ? » → tu pointes `AlreadyProcessed` en vert.
- **Sabote et observe** : change temporairement l'ARN du topic SNS dans l'ASL pour un topic inexistant, redéploie (`update-state-machine`), relance avec un **nouveau** `uploadId`. `NotifyFamily` échoue → où atterrit l'exécution ? (Réponse attendue : nulle part de propre — `NotifyFamily` n'a pas de `Catch`. C'est le **PIÈGE #5** du module. Le coach te fait **ajouter** un `Catch` `States.ALL` sur `NotifyFamily` et raisonner sur ce qu'on compense.)
- **Justifie Standard vs Express** pour ce workflow, puis pour le « digest quotidien » de TribuZen (§5). Si tu hésites, relis le tableau 2.8.
- **Red flag** : si tu as codé une Lambda « orchestrateur » qui appelle les autres à la chaîne au lieu d'une state machine → PIÈGE #1, on recommence.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 16 :**

1. Reconstruis la state machine **de mémoire**, en **30 minutes**, via **Workflow Studio** (Console, mode Design) cette fois — pas le fichier ASL. Tu dois retrouver `Choice`, `Task` DynamoDB, les deux `Catch` dans le bon ordre.
2. Ajoute un état **`Parallel`** : écrire le feed **et** publier un event d'audit SNS **en même temps** (module 16 §2.5). Les deux branches doivent réussir avant `NotifyFamily`.
3. Ajoute un `Catch` sur `NotifyFamily` (le trou que le coach t'a montré).
4. **Contrainte dure** : prouve l'idempotence **et** détruis toutes les ressources dans le même créneau. Si une ressource survit à la fin, l'exercice est raté (c'est le réflexe teardown qu'on ancre).

**Critère de réussite :** rejeu du même `uploadId` = `SUCCEEDED` sans doublon, `Parallel` visible dans le graphe, et `list-state-machines` vide à la fin.

---

## Teardown obligatoire (NE PAS SAUTER)

Détruis **dans cet ordre**. Remplace les ARN/IDs par les tiens.

```bash
# 1. State machine
aws stepfunctions delete-state-machine \
  --state-machine-arn arn:aws:states:eu-west-1:123456789012:stateMachine:TribuZenAvatarWorkflow \
  --region eu-west-1

# 2. Table DynamoDB
aws dynamodb delete-table --table-name TribuZenFeed --region eu-west-1

# 3. Topic SNS
aws sns delete-topic \
  --topic-arn arn:aws:sns:eu-west-1:123456789012:tribuzen-notify --region eu-west-1

# 4. Role IAM : detacher la policy inline PUIS supprimer le role
aws iam delete-role-policy \
  --role-name TribuZenAvatarWorkflowRole --policy-name TribuZenAvatarWorkflowPolicy
aws iam delete-role --role-name TribuZenAvatarWorkflowRole
```

**Vérifie que tout a disparu :**

```bash
aws stepfunctions list-state-machines --region eu-west-1 \
  --query "stateMachines[?name=='TribuZenAvatarWorkflow']"
aws dynamodb describe-table --table-name TribuZenFeed --region eu-west-1   # doit echouer : ResourceNotFound
aws iam get-role --role-name TribuZenAvatarWorkflowRole                    # doit echouer : NoSuchEntity
```

Les deux commandes de fin qui **échouent** = teardown réussi. Rien ne doit rester : Step Functions et DynamoDB on-demand ne coûtent rien au repos, mais l'hygiène « je déploie, j'observe, je détruis » est le réflexe pro qu'on entraîne à chaque lab cloud.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette orchestration est infra, pas front — elle vivra en **CDK** (module 05) sous :

```
tribuzen-infra/
  lib/
    avatar-workflow-stack.ts   # sfn.StateMachine + les Task states
    tribuzen-feed-table.ts     # dynamodb.Table (single-table)
```

**Différences avec le lab :**

- `GenerateThumbnail` deviendra une **vraie Lambda** (module 06, Sharp/rvb → miniature 200×200), avec son `Retry` propre sur `States.TaskFailed`.
- La state machine sera **déployée par CI/CD** (module 17 : GitHub Actions → AWS via OIDC), jamais à la main en prod.
- Les rôles IAM seront générés par le CDK au **moindre privilège** par état, pas une policy inline écrite à la main.
- On câblera le déclencheur réel : **S3 `ObjectCreated` sur `tribuzen-avatars` → EventBridge → `StartExecution`** (chorégraphie en amont, orchestration en aval — module 16 §5).
- Le choix **Standard** est confirmé ici (auditabilité de l'upload) ; le « digest quotidien » utilisera **Express** (haut volume, idempotent).

**Commit cible :**
```
feat(infra): avatar workflow — Step Functions Standard, putItem idempotent + saga Catch
```
