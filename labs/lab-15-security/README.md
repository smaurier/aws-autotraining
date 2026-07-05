# Lab 15 — Sécurité AWS : KMS + Secrets Manager + Lambda au moindre privilège

> **Outcome :** à la fin, tu sais créer une **customer managed KMS key**, y chiffrer un secret dans **Secrets Manager**, écrire une **Lambda** qui le lit avec un rôle IAM **au moindre privilège** (deux actions, deux ARN exacts), prouver que le moindre privilège tient, puis **tout détruire** (teardown) en maîtrisant le coût.
> **Vrai outil :** AWS CLI v2 sur un **vrai compte AWS** (KMS, Secrets Manager, Lambda, IAM). Aucun harnais simulé, aucun mock.
> **Feedback :** le coach valide en session — sortie CLI réelle à l'appui (pas de test-runner auto-correcteur).

> ⚠️ **Lab sécurité, exécuté sur un vrai compte.** Rien de dangereux ici : on chiffre un **secret jouet** (`sk_test_...`, jamais une vraie clé de prod), on ne touche pas au compte root, on ne désactive aucun garde-fou. Tu peux le faire dans un compte sandbox. Le **teardown est obligatoire** (section dédiée) : sans lui, la KMS key coûte ~1 USD/mois et le secret ~0,40 USD/mois.

---

## Free Tier & coût — à lire AVANT de commencer

| Ressource | Free Tier | Coût réel si tu laisses traîner |
|-----------|-----------|--------------------------------|
| **Customer managed KMS key** | **PAS de free tier sur la clé** | ~**1 USD / mois** par clé, au prorata. Les 20 000 requêtes KMS/mois sont, elles, gratuites. |
| **Secrets Manager** | 30 jours d'essai par secret | ~**0,40 USD / mois** par secret + 0,05 USD / 10 000 appels après l'essai. |
| **Lambda** | 1 M requêtes + 400 000 GB-s / mois **à vie** | ~0 pour ce lab. |
| **CloudWatch Logs** | 5 Go ingestion/mois | ~0 pour ce lab. |

**Conséquence pédagogique :** la KMS key n'est PAS free tier. Le teardown n'est pas optionnel « pour faire propre » — c'est la seule façon d'arrêter la facturation. Et comme KMS **impose un délai de 7 à 30 jours** avant suppression effective (voir Teardown), tu dois **planifier** la suppression dès aujourd'hui, pas « y penser plus tard ».

---

## Prérequis

- AWS CLI v2 configurée (`aws configure`) sur un profil avec les droits d'admin de ce lab (création KMS/secret/rôle/Lambda). En prod ce serait un rôle de déploiement dédié — ici, ton profil sandbox suffit.
- Région de travail cohérente. Ce lab utilise **`eu-west-3`** (Paris). Adapte si besoin, mais reste sur **une seule** région d'un bout à l'autre.
- Modules 01 (IAM), 06 (Lambda) et 15 (ce cours) lus.
- `jq` recommandé pour lire les sorties JSON (facultatif).

Pose une fois pour toutes ton `ACCOUNT_ID` et ta région :

```bash
export AWS_REGION=eu-west-3
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "$ACCOUNT_ID / $AWS_REGION"
```

---

## Énoncé

Tu reproduis, en réel, le cœur de l'Exemple 1 du module (sortir un secret du code et le chiffrer sous une clé que tu gouvernes) — appliqué au mailer transactionnel de **TribuZen**.

Tu dois obtenir, à la fin :

1. Une **customer managed KMS key** symétrique, avec l'alias `alias/tribuzen-lab`, **rotation automatique activée**.
2. Un secret **Secrets Manager** nommé `tribuzen/lab/mailer-api-key`, contenant une clé jouet, **chiffré par ta KMS key** (pas par la clé AWS managed par défaut).
3. Une **Lambda** `tribuzen-lab-read-secret` qui lit ce secret au runtime et renvoie une **preuve masquée** (jamais le secret en clair dans les logs).
4. Un **rôle d'exécution IAM au moindre privilège** : exactement `secretsmanager:GetSecretValue` sur l'ARN du secret, `kms:Decrypt` sur l'ARN de la clé, et les logs CloudWatch de base. **Rien d'autre** — pas de `secretsmanager:*`, pas de `Resource: "*"`.
5. Une **preuve négative** : tu montres qu'en retirant la permission `kms:Decrypt`, la Lambda **échoue** — c'est la démonstration que le moindre privilège est réellement en place (et non un `*` déguisé).
6. Un **teardown planifié** : secret supprimé, rôle supprimé, Lambda supprimée, **KMS key programmée pour suppression** (le délai KMS ne permet pas la suppression immédiate).

**Contrainte forte (sécurité) :** aucune wildcard de ressource (`Resource: "*"`) ni d'action (`secretsmanager:*`, `kms:*`) dans la policy d'exécution de la Lambda. Si tu écris une étoile, le critère de réussite tombe.

**Pas de gap-fill** — tu écris les commandes et les policies toi-même, à partir du squelette d'étapes ci-dessous.

---

## Étapes (en friction)

1. **Crée la KMS key** avec `aws kms create-key` (customer managed, symétrique par défaut), tague-la `app=tribuzen`. Récupère son `KeyId`. Crée l'alias `alias/tribuzen-lab`. Active la rotation.
2. **Crée le secret** avec `aws secretsmanager create-secret`, en passant `--kms-key-id alias/tribuzen-lab` pour qu'il soit chiffré sous **ta** clé. Valeur : `sk_test_tribuzen_lab_do_not_use`.
3. **Écris le code de la Lambda** (`index.mjs`) : lire `tribuzen/lab/mailer-api-key` via `@aws-sdk/client-secrets-manager`, ne **jamais** logguer la valeur en clair — logguer seulement une empreinte masquée (ex. 4 derniers caractères). Zippe.
4. **Écris la trust policy** du rôle (qui peut assumer le rôle : le service `lambda.amazonaws.com`) et **crée le rôle** avec `aws iam create-role`.
5. **Écris la permission policy au moindre privilège** (2 statements métier + logs) avec les **ARN exacts** du secret et de la clé — pas d'étoile de ressource. Attache-la (inline ou managed) au rôle. Ajoute aussi les droits logs (via `AWSLambdaBasicExecutionRole` managé AWS, c'est admis).
6. **Crée la Lambda** avec `aws lambda create-function` (runtime `nodejs20.x`, handler `index.handler`, le rôle ci-dessus).
7. **Invoque** la Lambda. Vérifie qu'elle renvoie le masque et que **le secret en clair n'apparaît nulle part** (ni réponse, ni logs).
8. **Preuve négative** : retire `kms:Decrypt` de la policy, réinvoque, observe l'échec `AccessDenied` côté KMS. Remets le droit. C'est la partie qui *prouve* le moindre privilège.
9. **Teardown** (section dédiée) : supprime secret + Lambda + rôle, puis **programme** la suppression de la KMS key (délai 7 j minimum).

> Friction voulue : à l'étape 5, tu vas être tenté d'écrire `Resource: "*"` pour « que ça marche ». Résiste. Le point du lab est justement de coller aux deux ARN exacts.

---

## Critères de réussite

Le coach valide si **tous** ces points sont vrais, sortie CLI à l'appui :

- [ ] `aws kms describe-key --key-id alias/tribuzen-lab` renvoie `KeyManager: CUSTOMER` et l'alias existe.
- [ ] `aws kms get-key-rotation-status` renvoie `KeyRotationEnabled: true`.
- [ ] `aws secretsmanager describe-secret` sur le secret montre un `KmsKeyId` **pointant sur ta clé** (pas `aws/secretsmanager`).
- [ ] La policy d'exécution de la Lambda contient **exactement** `secretsmanager:GetSecretValue` et `kms:Decrypt`, chacune sur un **ARN précis**. Aucun `"*"` de ressource, aucun `secretsmanager:*` / `kms:*`.
- [ ] L'invocation nominale renvoie le masque (ex. `****...use`) et **le secret en clair n'apparaît ni dans la réponse ni dans les logs CloudWatch**.
- [ ] La **preuve négative** est faite : sans `kms:Decrypt`, l'invocation échoue avec un `AccessDeniedException` provenant de KMS (et non de Secrets Manager).
- [ ] Le teardown est **lancé** : secret en suppression, rôle+Lambda supprimés, KMS key en `PendingDeletion`.

---

## Corrigé complet commenté

> À exécuter tel quel après avoir posé `AWS_REGION` et `ACCOUNT_ID` (voir Prérequis). Les commandes sont idempotentes-friendly : en cas d'erreur « already exists », adapte plutôt que de relancer aveuglément.

### 1. KMS key + alias + rotation

```bash
# Crée la customer managed key (symétrique ENCRYPT_DECRYPT par défaut).
# On capture le KeyId tout de suite : on en aura besoin partout.
KEY_ID=$(aws kms create-key \
  --description "TribuZen lab — clé de chiffrement du secret mailer" \
  --tags TagKey=app,TagValue=tribuzen \
  --query KeyMetadata.KeyId --output text)
echo "KEY_ID=$KEY_ID"

# ARN complet de la clé — c'est lui qu'on mettra dans la policy (Resource exact).
KEY_ARN=$(aws kms describe-key --key-id "$KEY_ID" \
  --query KeyMetadata.Arn --output text)
echo "KEY_ARN=$KEY_ARN"

# Alias lisible : on ne manipule plus l'ID brut ensuite.
aws kms create-alias \
  --alias-name alias/tribuzen-lab \
  --target-key-id "$KEY_ID"

# Rotation automatique (365 j par défaut). Critère de réussite.
aws kms enable-key-rotation --key-id "$KEY_ID"
```

### 2. Secret chiffré sous NOTRE clé

```bash
# --kms-key-id force le chiffrement sous alias/tribuzen-lab.
# SANS ce flag, Secrets Manager aurait pris la clé AWS managed aws/secretsmanager
# (gratuite, mais non gouvernée par nous → ce n'est pas ce qu'on veut ici).
SECRET_ARN=$(aws secretsmanager create-secret \
  --name tribuzen/lab/mailer-api-key \
  --description "TribuZen lab — clé API mailer (JOUET, ne pas réutiliser)" \
  --secret-string 'sk_test_tribuzen_lab_do_not_use' \
  --kms-key-id alias/tribuzen-lab \
  --query ARN --output text)
echo "SECRET_ARN=$SECRET_ARN"

# Vérif : le KmsKeyId doit être notre alias/clé, PAS aws/secretsmanager.
aws secretsmanager describe-secret \
  --secret-id tribuzen/lab/mailer-api-key \
  --query '{name:Name, kms:KmsKeyId}'
```

### 3. Code Lambda (jamais le secret en clair dans les logs)

`index.mjs` :

```js
// index.mjs — runtime nodejs20.x. Le SDK AWS v3 est fourni par le runtime Lambda.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({})

// Cache d'invocation : le conteneur Lambda survit entre deux appels à chaud,
// on évite un appel Secrets Manager (et un Decrypt KMS) par requête.
let cached

async function getMailerKey() {
  if (cached) return cached
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: 'tribuzen/lab/mailer-api-key' }),
  )
  cached = res.SecretString ?? ''
  return cached
}

export const handler = async () => {
  const apiKey = await getMailerKey()

  // Preuve d'accès SANS fuite : on ne logue/renvoie que les 4 derniers
  // caractères, masqués. Le secret en clair ne quitte jamais la fonction.
  const masked = '****...' + apiKey.slice(-3)
  console.log('Secret lu avec succès, empreinte masquée =', masked)

  return { ok: true, masked } // jamais { apiKey } en clair
}
```

Zip :

```bash
zip function.zip index.mjs
```

### 4. Rôle d'exécution + trust policy

`trust-policy.json` — **qui** peut assumer le rôle (le service Lambda) :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

```bash
ROLE_ARN=$(aws iam create-role \
  --role-name tribuzen-lab-read-secret-role \
  --assume-role-policy-document file://trust-policy.json \
  --query Role.Arn --output text)
echo "ROLE_ARN=$ROLE_ARN"

# Logs CloudWatch de base — policy managée AWS, périmètre standard et admis.
aws iam attach-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### 5. Permission policy AU MOINDRE PRIVILÈGE

`least-privilege.json` — génère-le avec les ARN **capturés plus haut** (pas d'étoile) :

```bash
cat > least-privilege.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadMailerSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "$SECRET_ARN"
    },
    {
      "Sid": "DecryptWithTribuZenLabKey",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "$KEY_ARN"
    }
  ]
}
EOF
cat least-privilege.json  # relis : deux actions, deux ARN, zéro "*"
```

```bash
# Policy inline attachée au rôle. Inline = liée au cycle de vie du rôle,
# parfait pour une permission taillée sur mesure et jetable.
aws iam put-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-name mailer-secret-least-privilege \
  --policy-document file://least-privilege.json
```

> Pourquoi ces deux actions et pas une seule ? `GetSecretValue` récupère le secret **chiffré** ; pour le rendre en clair, Secrets Manager appelle `kms:Decrypt` **pour le compte de la Lambda** (contexte de chiffrement du secret). Sans `kms:Decrypt`, l'appel échoue côté KMS. C'est exactement l'étape 4 de l'Exemple 1 du module.

### 6. Création de la Lambda

```bash
# La propagation IAM d'un nouveau rôle peut prendre quelques secondes ;
# si create-function renvoie "cannot be assumed", réessaie une fois.
aws lambda create-function \
  --function-name tribuzen-lab-read-secret \
  --runtime nodejs20.x \
  --handler index.handler \
  --role "$ROLE_ARN" \
  --zip-file fileb://function.zip \
  --timeout 10
```

### 7. Invocation nominale

```bash
aws lambda invoke \
  --function-name tribuzen-lab-read-secret \
  --cli-binary-format raw-in-base64-out \
  response.json
cat response.json
# Attendu : {"ok":true,"masked":"****...use"} — le secret en clair n'y est pas.
```

Vérifie les logs (le masque doit y être, jamais la valeur brute) :

```bash
aws logs tail /aws/lambda/tribuzen-lab-read-secret --since 5m
```

### 8. Preuve négative — retirer kms:Decrypt

C'est le cœur du lab : montrer que le privilège est **réellement** minimal.

```bash
# Policy AMPUTÉE de kms:Decrypt.
cat > no-decrypt.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadMailerSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "$SECRET_ARN"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-name mailer-secret-least-privilege \
  --policy-document file://no-decrypt.json

# Laisse quelques secondes à IAM pour propager, puis réinvoque.
aws lambda invoke \
  --function-name tribuzen-lab-read-secret \
  --cli-binary-format raw-in-base64-out \
  response-fail.json
cat response-fail.json
# Attendu : erreur AccessDeniedException provenant de KMS (kms:Decrypt),
# alors que GetSecretValue, lui, était autorisé. La donnée reste illisible.
```

Puis **restaure** le droit (remets `least-privilege.json`) :

```bash
aws iam put-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-name mailer-secret-least-privilege \
  --policy-document file://least-privilege.json
```

**Pourquoi ce corrigé est correct :**
- Le secret n'est jamais dans le code ni en variable d'environnement en clair : il vit dans Secrets Manager, chiffré sous une clé **que tu audites** (CloudTrail loggue chaque `Decrypt`).
- La policy tient sur **deux ARN exacts**. Un attaquant qui volerait ce rôle ne pourrait lire **que ce secret** et déchiffrer **que cette clé** — pas tout Secrets Manager, pas tout KMS.
- La Lambda ne fuit jamais la valeur : masque en sortie, masque en logs. Un secret qui traîne dans CloudWatch est un secret compromis.
- La preuve négative distingue les deux couches : `GetSecretValue` seul ne suffit pas, il faut aussi `kms:Decrypt`. C'est l'envelope encryption vue de l'extérieur.

---

## Teardown obligatoire

> **Non négociable.** La KMS key est facturée ~1 USD/mois tant qu'elle existe, et Secrets Manager ~0,40 USD/mois. Fais ceci **dès la fin de session**.

```bash
# 1. Lambda
aws lambda delete-function --function-name tribuzen-lab-read-secret

# 2. Rôle : détacher/supprimer les policies AVANT delete-role.
aws iam delete-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-name mailer-secret-least-privilege
aws iam detach-role-policy \
  --role-name tribuzen-lab-read-secret-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name tribuzen-lab-read-secret-role

# 3. Secret. Deux options :
#    a) recovery window mini de 7 jours (récupérable via restore-secret) :
aws secretsmanager delete-secret \
  --secret-id tribuzen/lab/mailer-api-key \
  --recovery-window-in-days 7
#    b) OU purge immédiate (secret jouet → acceptable ici) :
# aws secretsmanager delete-secret \
#   --secret-id tribuzen/lab/mailer-api-key \
#   --force-delete-without-recovery

# 4. KMS key : IMPOSSIBLE à supprimer immédiatement.
#    KMS impose un délai de 7 à 30 jours (défaut 30). On PLANIFIE la suppression
#    au minimum légal de 7 jours. Pendant ce délai, la clé passe en
#    "PendingDeletion", devient inutilisable en chiffrement, et n'est plus rotée.
aws kms schedule-key-deletion \
  --key-id alias/tribuzen-lab \
  --pending-window-in-days 7
```

**À retenir sur la suppression KMS :**
- On ne peut pas « rm -rf » une KMS key. Le délai 7–30 j (défaut 30) est une **sécurité** : toute donnée encore chiffrée sous cette clé deviendrait irrécupérable après suppression.
- Pendant la fenêtre, tu peux annuler : `aws kms cancel-key-deletion --key-id <id>` puis `aws kms enable-key <id>`.
- **La facturation ~1 USD/mois court tant que la clé n'est pas réellement supprimée** (fin du délai). D'où l'intérêt de programmer la suppression **maintenant**, pas dans un mois.

**Vérifie que tout est bien parti :**

```bash
aws kms describe-key --key-id alias/tribuzen-lab \
  --query 'KeyMetadata.{state:KeyState, deletion:DeletionDate}'
# Attendu : state = PendingDeletion, avec une DeletionDate à ~7 jours.
aws lambda get-function --function-name tribuzen-lab-read-secret 2>&1 | head -1
# Attendu : ResourceNotFoundException (bien supprimée).
```

> **Rappel J+7 :** note dans ton agenda de repasser dans 7 jours vérifier que la clé est bien passée de `PendingDeletion` à supprimée (elle disparaît alors de `list-keys`). Sinon tu continues de payer.

---

## Feedback coach (auto-évaluation en session)

Le coach ne lance pas de test-runner : il regarde **ta sortie CLI** et te fait verbaliser. Questions de contrôle :

1. **« Montre-moi ta policy d'exécution. »** — S'il y a un seul `"*"` de ressource ou une action `secretsmanager:*` / `kms:*`, le lab est raté sur son objectif. Le moindre privilège n'est pas un slogan, c'est deux ARN.
2. **« Pourquoi deux permissions et pas une ? »** — Tu dois expliquer que `GetSecretValue` rend le secret chiffré et que `kms:Decrypt` (appelé par Secrets Manager pour ton compte) le rend en clair. Si tu ne sais pas répondre, relis §2.3 et l'Exemple 1 du module.
3. **« Où est le secret en clair dans tes logs ? »** — Réponse attendue : nulle part. Si la valeur brute apparaît dans CloudWatch, c'est un incident, pas un lab réussi.
4. **« Fais la preuve négative. »** — Sans `kms:Decrypt`, l'échec doit venir de **KMS** (`AccessDenied` sur `Decrypt`), pas de Secrets Manager. Cette distinction prouve que tu as compris la chaîne.
5. **« La clé KMS est-elle programmée pour suppression ? »** — Si la réponse est « je le ferai plus tard », le coach te fait exécuter `schedule-key-deletion` **tout de suite**. Le coût court sinon.

Signaux d'alarme (le coach t'arrête) :
- Une vraie clé de prod utilisée comme valeur de secret → jamais, même en sandbox.
- `Resource: "*"` « pour débloquer » → on répare, on ne valide pas.
- Teardown remis à plus tard → on le lance en séance.

---

## Variante J+30 (fading)

**Même objectif, contrainte ajoutée — sans rouvrir ce corrigé :**

Reproduis toute la chaîne **de mémoire, en 30 minutes**, avec **une** exigence de sécurité supplémentaire au choix (le coach en impose une) :

1. **Permissions boundary.** Le rôle d'exécution doit être créé **sous une permissions boundary** que tu écris toi-même : la boundary plafonne le rôle à `secretsmanager:GetSecretValue`, `kms:Decrypt` et les actions `logs:*` de base — de sorte que **même si** quelqu'un attachait plus tard une policy large au rôle, l'intersection resterait limitée. Prouve-le en attachant volontairement une policy `AdministratorAccess` au rôle et en montrant que la Lambda ne peut **toujours** rien faire d'autre que lire ce secret.
2. **OU chiffrement d'un objet S3.** Ajoute un bucket avec chiffrement par défaut **SSE-KMS** sous `alias/tribuzen-lab`, et fais lire par la Lambda un objet chiffré — le rôle doit alors avoir `s3:GetObject` sur l'objet **et** `kms:Decrypt` sur la clé, toujours sans étoile.

**Critère de réussite :** la contrainte tient (boundary ou S3), la preuve négative est refaite, **et le teardown complet est exécuté en fin de séance** — bucket vidé/supprimé inclus si tu as pris l'option S3.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce lab devient une brique réelle de l'infra — mais **produite par CDK** (module 05), pas en CLI à la main.

**Ce qui change par rapport au lab :**

- La KMS key, le secret, le rôle et la Lambda sont des **constructs CDK** (`aws-cdk-lib`) : `kms.Key` avec `enableKeyRotation: true`, `secretsmanager.Secret` avec `encryptionKey` pointant sur la clé, `lambda.Function` dont on appelle `secret.grantRead(fn)` et `key.grantDecrypt(fn)`. Ces `grant*` **génèrent la policy au moindre privilège pour toi** — exactement les deux ARN, sans étoile, sans les écrire à la main.
- La vraie clé du mailer n'est jamais dans le code CDK : on crée le secret **vide** puis on injecte la valeur hors versionnement (console/CLI/rotation), ou on branche une **rotation Lambda** planifiée.
- Le teardown n'est pas manuel : `cdk destroy` détruit la stack. La KMS key garde malgré tout sa `removalPolicy` — en prod on la met à `RETAIN` (on ne détruit pas une clé qui chiffre encore des données) ; pour un environnement jetable, `DESTROY` programme la suppression avec le délai KMS.

**Commit cible :**

```
feat(infra): mailer secret chiffré KMS + Lambda least-privilege (grantRead/grantDecrypt)
```

> Le lab t'apprend le **mécanisme brut** (les deux ARN, la fenêtre de suppression KMS, la preuve négative). CDK l'automatise ensuite — mais tu ne peux pas faire confiance à `grantRead` si tu ne sais pas ce qu'il génère. C'est pour ça qu'on le fait à la main une fois.
