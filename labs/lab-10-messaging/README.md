# Lab 10 — Messaging : fan-out SNS → SQS avec DLQ

> **Outcome :** à la fin, tu sais créer un vrai topic SNS et deux vraies queues SQS (avec DLQ + visibility timeout), câbler un fan-out, publier au CLI et vérifier que **le même message arrive dans chaque queue** — puis tout détruire.
> **Vrai outil :** compte AWS réel + **AWS CLI v2** (SQS, SNS). Pas de harnais de test simulé, pas de mock.
> **Feedback :** le coach valide en session au vu de tes commandes et de leurs sorties (pas de test-runner auto-correcteur).

> ⚠️ **Coût & Free Tier.** SQS (1 M requêtes/mois) et SNS (1 M publications/mois) sont couverts par le **Free Tier** : ce lab coûte ~0 €. **Mais** ne laisse rien traîner : la section **Teardown** en fin de lab est **obligatoire**. Travaille dans une région proche, ex. `eu-west-3` (Paris).

---

## Prérequis

- AWS CLI v2 configurée (`aws configure`) avec un profil non-root disposant des droits SQS/SNS (voir module 01).
- Ton **Account ID** à 12 chiffres : `aws sts get-caller-identity --query Account --output text`.
- Un shell où tu peux stocker des variables (les exemples utilisent la syntaxe `bash`/`git-bash` ; en PowerShell, remplace `$VAR` par `$env:VAR` ou une variable PowerShell `$VAR`).

Fixe une région et récupère ton account id une fois pour toutes :

```bash
export AWS_REGION=eu-west-3
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

---

## Énoncé

Tu implémentes le fan-out du cas concret du module 10 pour TribuZen : l'événement **« SortieCréée »** doit être diffusé à **deux** consommateurs indépendants — **email** et **projection** — chacun avec sa propre queue tampon et sa **DLQ**.

```
publish ──▶ SNS topic  tribuzen-outing-events
                ├──▶ SQS  outing-email       (visibility 60s, DLQ maxReceiveCount=3)
                └──▶ SQS  outing-projection  (visibility 60s, DLQ maxReceiveCount=3)
```

**Cahier des charges exact :**

1. Un topic SNS `tribuzen-outing-events`.
2. Deux queues principales `outing-email` et `outing-projection`, chacune avec **visibility timeout = 60 s**.
3. Une DLQ par queue (`outing-email-dlq`, `outing-projection-dlq`) branchée en **redrive policy** avec **`maxReceiveCount = 3`**.
4. Chaque queue principale **abonnée** au topic, **avec la policy** qui autorise SNS à y écrire.
5. **Un seul** `sns publish` doit déposer le message **dans les deux** queues.
6. Vérifier la réception avec `receive-message` en **long polling** (`--wait-time-seconds 20`).
7. **Teardown complet** à la fin.

**Pas de gap-fill** : tu écris toi-même les commandes à partir des étapes ci-dessous. Le corrigé complet est plus bas — n'y va qu'après avoir essayé.

---

## Étapes (en friction)

1. **Crée les 4 queues** (2 principales + 2 DLQ) avec `aws sqs create-queue`. Note les `QueueUrl` renvoyés.
2. **Récupère l'ARN de chaque DLQ** (`aws sqs get-queue-attributes ... --attribute-names QueueArn`).
3. **Configure la redrive policy + le visibility timeout** sur chaque queue principale (`set-queue-attributes`).
4. **Crée le topic** SNS et note son `TopicArn`.
5. **Écris la policy SQS** qui autorise `sns.amazonaws.com` à `sqs:SendMessage` sur chaque queue principale, conditionnée par `aws:SourceArn` = ARN du topic, et applique-la (`set-queue-attributes` → attribut `Policy`).
6. **Abonne** les deux queues au topic (`aws sns subscribe --protocol sqs`).
7. **Publie** un message « SortieCréée » sur le topic.
8. **Reçois** le message depuis **chaque** queue et vérifie qu'il est bien présent dans les deux.
9. **(Bonus) Provoque la DLQ** : publie un message, reçois-le 3 fois **sans** le supprimer (attends l'expiration du visibility timeout entre deux réceptions, ou mets-le à 0 avec `change-message-visibility`), puis observe qu'il apparaît dans la DLQ.
10. **Teardown** : supprime abonnements, topic et les 4 queues.

---

## Corrigé complet commenté

> Remplace `eu-west-3` / `$ACCOUNT_ID` par les tiens. Les `QueueUrl` sont renvoyés à la création — réutilise exactement ceux que l'API te donne.

```bash
# ─── 0. Contexte ────────────────────────────────────────────────
export AWS_REGION=eu-west-3
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ─── 1. Les 4 queues ────────────────────────────────────────────
aws sqs create-queue --queue-name outing-email
aws sqs create-queue --queue-name outing-email-dlq
aws sqs create-queue --queue-name outing-projection
aws sqs create-queue --queue-name outing-projection-dlq

# URLs (déterministes, mais l'API les renvoie ; on les reconstruit ici pour lisibilité)
EMAIL_URL=https://sqs.$AWS_REGION.amazonaws.com/$ACCOUNT_ID/outing-email
EMAIL_DLQ_URL=https://sqs.$AWS_REGION.amazonaws.com/$ACCOUNT_ID/outing-email-dlq
PROJ_URL=https://sqs.$AWS_REGION.amazonaws.com/$ACCOUNT_ID/outing-projection
PROJ_DLQ_URL=https://sqs.$AWS_REGION.amazonaws.com/$ACCOUNT_ID/outing-projection-dlq

# ─── 2. ARN des DLQ (nécessaire pour la redrive policy) ─────────
EMAIL_DLQ_ARN=$(aws sqs get-queue-attributes --queue-url $EMAIL_DLQ_URL \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
PROJ_DLQ_ARN=$(aws sqs get-queue-attributes --queue-url $PROJ_DLQ_URL \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# ─── 3. Redrive policy (maxReceiveCount=3) + visibility timeout 60s ──
# La RedrivePolicy est une chaîne JSON échappée DANS le JSON d'attributs.
aws sqs set-queue-attributes --queue-url $EMAIL_URL --attributes "{
  \"VisibilityTimeout\": \"60\",
  \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$EMAIL_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
}"
aws sqs set-queue-attributes --queue-url $PROJ_URL --attributes "{
  \"VisibilityTimeout\": \"60\",
  \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$PROJ_DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
}"

# ─── 4. Topic SNS ───────────────────────────────────────────────
TOPIC_ARN=$(aws sns create-topic --name tribuzen-outing-events \
  --query 'TopicArn' --output text)

# ─── 5. Policy autorisant SNS à écrire dans chaque queue ────────
# Sans ça, l'abonnement se crée mais AUCUN message n'arrive (piège #5 du module).
EMAIL_ARN=arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:outing-email
PROJ_ARN=arn:aws:sqs:$AWS_REGION:$ACCOUNT_ID:outing-projection

aws sqs set-queue-attributes --queue-url $EMAIL_URL --attributes "{
  \"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":\\\"sns.amazonaws.com\\\"},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"$EMAIL_ARN\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"$TOPIC_ARN\\\"}}}]}\"
}"
aws sqs set-queue-attributes --queue-url $PROJ_URL --attributes "{
  \"Policy\": \"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":\\\"sns.amazonaws.com\\\"},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"$PROJ_ARN\\\",\\\"Condition\\\":{\\\"ArnEquals\\\":{\\\"aws:SourceArn\\\":\\\"$TOPIC_ARN\\\"}}}]}\"
}"

# ─── 6. Abonner les deux queues au topic ────────────────────────
aws sns subscribe --topic-arn $TOPIC_ARN --protocol sqs --notification-endpoint $EMAIL_ARN
aws sns subscribe --topic-arn $TOPIC_ARN --protocol sqs --notification-endpoint $PROJ_ARN

# ─── 7. Publier UN message "SortieCréée" ────────────────────────
aws sns publish --topic-arn $TOPIC_ARN \
  --message '{"outingId":"out-42","familyId":"fam-7","startsAt":"2026-07-06T10:00:00Z"}'

# ─── 8. Vérifier la réception dans CHAQUE queue (long polling) ──
# Par défaut SNS enveloppe le message dans une "SNS envelope" JSON ;
# le corps publié est dans le champ .Message de cette enveloppe.
aws sqs receive-message --queue-url $EMAIL_URL --wait-time-seconds 20
aws sqs receive-message --queue-url $PROJ_URL --wait-time-seconds 20
# → les deux doivent retourner un message contenant outingId=out-42.
```

**Bonus — prouver la DLQ (étape 9) :**

```bash
# Publie un message, puis reçois-le 3 fois SANS le supprimer.
# Après chaque réception, remets-le visible immédiatement pour accélérer :
RH=$(aws sqs receive-message --queue-url $EMAIL_URL --wait-time-seconds 20 \
     --query 'Messages[0].ReceiptHandle' --output text)
aws sqs change-message-visibility --queue-url $EMAIL_URL --receipt-handle "$RH" --visibility-timeout 0
# Répète la paire receive + change-visibility 0 trois fois.
# À la 4e tentative de réception, le message n'est plus dans outing-email :
aws sqs receive-message --queue-url $EMAIL_DLQ_URL --wait-time-seconds 20
# → il est maintenant dans outing-email-dlq (maxReceiveCount=3 dépassé).
```

**Pourquoi ce corrigé est correct :**

- **Un seul** `sns publish` remplit **les deux** queues : c'est le fan-out. Chaque queue est un buffer indépendant.
- La **policy SQS** (étape 5) est la partie que tout le monde oublie : sans le `Principal` SNS + `Condition aws:SourceArn`, l'abonnement existe mais les messages n'arrivent jamais. C'est le piège #5 du module.
- La **redrive policy** avec `maxReceiveCount=3` déplace un message poison en DLQ après 3 réceptions sans suppression — vérifié à l'étape bonus.
- Le **visibility timeout à 60 s** dépasse largement le temps d'un envoi d'email simulé : pas de double traitement accidentel.
- Le **long polling** (`--wait-time-seconds 20`) évite les réponses vides quand le message n'est pas encore propagé par SNS.

---

## Teardown (OBLIGATOIRE)

Rien ci-dessous ne coûte tant que ça reste dans le Free Tier, mais on ne laisse jamais traîner d'infra.

```bash
# 1. Désabonner (lister puis supprimer les abonnements du topic)
aws sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN \
  --query 'Subscriptions[].SubscriptionArn' --output text | tr '\t' '\n' | while read SUB; do
    [ "$SUB" != "PendingConfirmation" ] && aws sns unsubscribe --subscription-arn "$SUB"
  done

# 2. Supprimer le topic
aws sns delete-topic --topic-arn $TOPIC_ARN

# 3. Supprimer les 4 queues
aws sqs delete-queue --queue-url $EMAIL_URL
aws sqs delete-queue --queue-url $EMAIL_DLQ_URL
aws sqs delete-queue --queue-url $PROJ_URL
aws sqs delete-queue --queue-url $PROJ_DLQ_URL
```

> ⏳ La suppression d'une queue SQS peut prendre jusqu'à **60 s** à se propager — normal si un `create-queue` du même nom échoue juste après.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé :**

1. Ajoute un **troisième** consommateur `outing-audit` (queue + DLQ + abonnement + policy) — en **moins de 20 minutes**.
2. Sur l'abonnement de `outing-audit`, ajoute une **filter policy** SNS pour qu'il ne reçoive **que** les messages dont l'attribut `type` vaut `premium` (publie avec `--message-attributes` pour tester). Vérifie qu'un message sans cet attribut **n'arrive pas** dans `outing-audit` mais arrive toujours dans `outing-email`.
3. **Reproduis tout le fan-out de mémoire**, sans copier-coller le corrigé.

**Critère de réussite :** un `sns publish` avec `type=premium` remplit les 3 queues ; un `sns publish` sans attribut ne remplit que `outing-email` et `outing-projection`. Teardown complet à la fin (n'oublie pas la 3e paire de queues).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce fan-out n'est pas câblé à la main au CLI en production : il est décrit en **CDK** (module 05). Le CLI de ce lab sert à **comprendre** ce que le CDK génère.

```
tribuzen-infra/
  lib/
    messaging-stack.ts   ← Topic SNS + Queues SQS + DLQ + Subscriptions + policies (CDK)
  src/
    handlers/
      post-outing.ts      ← publie "SortieCréée" sur le topic, puis rend la main
      consume-email.ts    ← Lambda consumer de outing-email (module 06)
      consume-projection.ts
```

**Différences avec le lab :**

- Les ARN (topic, queues) sont injectés par le **CDK**, pas reconstruits à la main.
- Les policies SQS et les roles des consumers (moindre privilège, module 01) sont générés par les constructs L2 (`topic.addSubscription(new SqsSubscription(queue))` pose la policy automatiquement).
- Chaque consumer est une **Lambda** (module 06) avec `batchItemFailures` pour ne rejouer que les messages échoués.

**Commit cible :**
```
feat(messaging): fan-out SortieCréée — SNS topic + SQS email/projection + DLQ
```
