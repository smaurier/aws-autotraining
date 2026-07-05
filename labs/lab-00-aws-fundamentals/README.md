# Lab 00 — Fondations AWS : compte, CLI, budget

> **Outcome :** à la fin, tu as un compte AWS sécurisé (MFA root + utilisateur IAM), l'AWS CLI configurée avec un profil nommé pointant sur Paris, un budget d'alerte, et tu sais lire ton infrastructure via CLI.
> **Vrai outil :** Console AWS (navigateur) + AWS CLI v2 (terminal réel). Aucun harnais de test simulé.
> **Feedback :** le coach valide en session en regardant tes sorties CLI et ta console — pas de test-runner auto-correcteur.

> ⚠️ **Coût & Free Tier.** Ce lab reste **100 % dans le Free Tier** : aucune ressource facturable n'est créée (pas d'EC2, pas de S3). Une carte bancaire est exigée à l'inscription mais rien n'est débité. Le budget que tu poses en étape 4 est ta ceinture de sécurité. **Teardown** en fin de lab (voir section dédiée).

---

## Énoncé

Tu ouvres l'infrastructure cloud de **TribuZen**. Avant tout code, tu montes un poste de travail AWS sûr et tu vérifies que ta CLI parle bien au bon compte, dans la bonne région, avec la bonne identité.

Objectifs concrets :

1. Créer (ou réutiliser) un compte AWS et **sécuriser le root** avec le MFA.
2. Créer un **utilisateur IAM** `sylvain-dev` avec accès administrateur + ses clés d'accès.
3. Installer et configurer l'**AWS CLI v2** avec un **profil nommé** `tribuzen-dev` sur `eu-west-3` (Paris).
4. Poser un **AWS Budget** à 5 $/mois avec alertes.
5. **Lire l'infrastructure** via CLI : identité, régions, zones de disponibilité de Paris.

Pas de gap-fill : tu exécutes les vraies commandes dans ton terminal et tu observes les vraies sorties.

### Starter minimal

Aucun fichier de code. Ton point de départ est :

- un navigateur sur [aws.amazon.com](https://aws.amazon.com),
- un terminal (bash ou PowerShell),
- l'[AWS CLI v2 installée](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (`aws --version` doit répondre `aws-cli/2.x`).

---

## Étapes (en friction)

1. **Compte & MFA root.** Crée le compte (ou réutilise le tien). Dans la console → menu du compte → **Security credentials** → active le **MFA** sur le root (app TOTP type Authy/Google Authenticator). Déconnecte-toi ensuite du root.
2. **Utilisateur IAM.** Console → **IAM** → Users → *Create user* `sylvain-dev`. Attache la policy `AdministratorAccess` (on affinera au module 01). Crée-lui des **access keys** (usage : *Command Line Interface*). Note l'Access Key ID + Secret **une seule fois**.
3. **Configure la CLI avec un profil nommé.** Lance `aws configure --profile tribuzen-dev`, renseigne les clés de `sylvain-dev`, région `eu-west-3`, output `json`. Active le profil pour la session.
4. **Budget d'alerte.** Console → **Billing and Cost Management** → **Budgets** → *Create budget* → *Cost budget* → 5 $/mois → alertes à 50/80/100 % vers ton e-mail.
5. **Lecture d'infra en CLI.** Vérifie ton identité (`sts get-caller-identity`), liste les régions, puis liste les **AZ de Paris**. Confirme que ton Arn n'est **pas** `:root`.
6. **Auto-contrôle.** Ouvre `~/.aws/config` et `~/.aws/credentials` : vérifie que le profil `tribuzen-dev` y est, et que **le secret n'est nulle part ailleurs** (surtout pas dans un dépôt Git).

---

## Corrigé complet commenté

```bash
# ─────────────────────────────────────────────────────────────
# Étape 3 — configuration du profil nommé
# (les clés proviennent de l'utilisateur IAM sylvain-dev, JAMAIS du root)
# ─────────────────────────────────────────────────────────────
aws configure --profile tribuzen-dev
# AWS Access Key ID [None]: AKIA...
# AWS Secret Access Key [None]: wJal...
# Default region name [None]: eu-west-3     # Paris — données familiales TribuZen, RGPD
# Default output format [None]: json

# Active ce profil pour toute la session shell :
export AWS_PROFILE=tribuzen-dev             # PowerShell : $env:AWS_PROFILE = "tribuzen-dev"

# ─────────────────────────────────────────────────────────────
# Étape 5 — lecture d'infrastructure via CLI
# ─────────────────────────────────────────────────────────────

# 5.1 QUI suis-je pour AWS ? L'Arn NE DOIT PAS finir par ":root".
aws sts get-caller-identity
# {
#   "UserId": "AIDA...",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/sylvain-dev"   ← ✅ utilisateur IAM
# }

# 5.2 Lister toutes les régions accessibles (table lisible)
aws ec2 describe-regions --query 'Regions[].RegionName' --output table

# 5.3 Lister les zones de disponibilité de Paris (eu-west-3)
#     --region surcharge ponctuellement la région du profil.
aws ec2 describe-availability-zones \
  --region eu-west-3 \
  --query 'AvailabilityZones[].ZoneName' \
  --output table
# ┌──────────────────────────┐
# │  DescribeAvailabilityZones │
# ├──────────────────────────┤
# │  eu-west-3a               │   ← 3 AZ = base de la haute disponibilité
# │  eu-west-3b               │
# │  eu-west-3c               │
# └──────────────────────────┘

# ─────────────────────────────────────────────────────────────
# Étape 6 — auto-contrôle des fichiers de config
# ─────────────────────────────────────────────────────────────
# ~/.aws/config          → région et output, par profil (NON secret)
# ~/.aws/credentials     → les clés (SECRET) ; ne JAMAIS commiter ce fichier

# Vérifie qu'aucune clé ne traîne dans un projet Git :
#   grep -r "AKIA" .        (bash)      → doit ne rien retourner dans le repo
#   Select-String -Pattern "AKIA" -Path . -Recurse   (PowerShell)
```

Contenu attendu des fichiers après configuration :

```ini
# ~/.aws/config
[profile tribuzen-dev]
region = eu-west-3
output = json
```

```ini
# ~/.aws/credentials
[tribuzen-dev]
aws_access_key_id = AKIA...
aws_secret_access_key = wJal...
```

**Pourquoi ce corrigé est correct :**
- Les clés appartiennent à `sylvain-dev` (utilisateur IAM), pas au root : `get-caller-identity` le prouve via l'Arn.
- Le **profil nommé** isole TribuZen d'autres comptes AWS éventuels — pas de collision avec `[default]`.
- `--region eu-west-3` sur la commande AZ montre l'ordre de priorité : la ligne de commande surcharge le réglage du profil.
- Le **budget** (étape 4, dans la console) est le filet de sécurité : même si tu oublies une ressource, tu es alerté·e avant la facture.
- Le secret vit **uniquement** dans `~/.aws/credentials`, jamais dans le code.

---

## Rappel teardown & Free Tier

Ce lab ne crée **aucune ressource facturable** — le teardown est donc léger mais réel :

1. **Rien à détruire côté ressources** (pas d'EC2/S3/EIP créés). Si tu as expérimenté au-delà de l'énoncé, détruis-le maintenant (`aws ec2 describe-instances`, puis terminate ; libère toute Elastic IP non attachée).
2. **Garde** le MFA root, l'utilisateur IAM et le budget : ce sont des acquis permanents, pas des ressources de test.
3. **Fais tourner ou supprime les clés d'accès** si tu ne t'en sers plus un moment — une clé oubliée est une clé à risque.
4. Vérifie ta console **Billing** en fin de session : le solde doit rester à 0 $ (hors crédits Free Tier).

> Règle du cours : à la fin de CHAQUE lab AWS, tu te poses la question « qu'ai-je créé qui coûte, et l'ai-je détruit ? ». Ici la réponse est « rien », mais le réflexe se prend dès le module 00.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, sans rouvrir ce corrigé ni le module 00 :**

1. Configure un **second profil** `tribuzen-prod` sur la région `eu-west-1` (Irlande), en **10 minutes**.
2. Sans utiliser `export`/`$env:`, lance une seule commande qui affiche les AZ d'Irlande **via le profil prod** (indice : `--profile`).
3. Écris en une phrase, de mémoire, qui (AWS ou toi) est responsable si : (a) une AZ d'Irlande brûle, (b) tu laisses le port 22 ouvert au monde sur une future instance.

**Critère de réussite :** les deux profils coexistent dans `~/.aws/config`, la commande prod renvoie `eu-west-1a/b/c`, et tes deux réponses de responsabilité sont correctes (a → AWS, b → toi).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce lab produit la **documentation d'infrastructure** de départ (pas encore d'IaC) :

```
tribuzen/
  infra/
    README.md        ← n° de compte, région eu-west-3, profil CLI tribuzen-dev,
                       budget 5 $/mois, MFA root, utilisateur IAM, grille de responsabilité
```

**Différences par rapport au lab :**

- En production TribuZen, on remplacera à terme les **clés statiques** par des **rôles IAM** et l'auth par SSO (module 01) — ici on reste sur des access keys pour démarrer.
- La région `eu-west-3` (Paris) est actée pour la conformité RGPD des données familiales ; `eu-west-1` servira d'exercice/backup.
- Le budget passera de 5 $ (apprentissage) à un budget calibré quand l'infra réelle (Lambda, S3, DynamoDB) sera déployée.

**Commit cible :**
```
docs(infra): fondations AWS TribuZen — compte, région eu-west-3, profil CLI, budget, responsabilité partagée
```
