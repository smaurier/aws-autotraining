# 13 — CloudFront — CDN

> **Duree estimee** : 4h00
> **Difficulte** : 3/5
> **Prerequis** : Module 04 (S3), Module 06 (API Gateway), notions HTTP
> **Objectifs** :
> - Comprendre les concepts fondamentaux d'un **CDN** (Content Delivery Network)
> - Creer et configurer des **distributions CloudFront**
> - Maitriser les **cache behaviors**, TTL et **invalidation**
> - Securiser le contenu avec **OAC**, signed URLs et geo-restriction
> - Utiliser **Lambda@Edge** et **CloudFront Functions** pour le edge computing

---

## Qu'est-ce qu'un CDN ?

### Le probleme de la latence

Imaginez un utilisateur a Tokyo qui accede a un site web heberge sur un serveur a Paris. La requete doit traverser des milliers de kilometres de cables sous-marins, passer par de nombreux routeurs, et revenir avec la reponse. Ce trajet prend du temps — c'est la **latence reseau**.

Un **CDN** (Content Delivery Network) resout ce probleme en placant des copies du contenu sur des serveurs repartis dans le monde entier, au plus pres des utilisateurs.

### Vocabulaire essentiel

| Terme | Definition |
|-------|-----------|
| **Edge Location** | Un data center AWS situe dans une ville (ex : Tokyo, Sao Paulo). C'est la que le contenu est mis en cache |
| **Origin** | Le serveur source qui detient le contenu original (S3, ALB, serveur custom) |
| **PoP** (Point of Presence) | Un regroupement de edge locations dans une region geographique |
| **Distribution** | La configuration CloudFront qui definit quelles origines servir et comment |
| **Cache Hit** | La requete est servie depuis le edge — rapide |
| **Cache Miss** | Le contenu n'est pas en cache au edge, CloudFront va le chercher a l'origin |

### Comment ca fonctionne

```
Utilisateur (Tokyo)
       |
       v
Edge Location Tokyo  --[cache hit]--> Reponse rapide (~10ms)
       |
       | [cache miss]
       v
Origin (S3 Paris)  --> Reponse plus lente (~200ms)
       |
       v
Edge Location Tokyo stocke en cache pour les prochains utilisateurs
```

A la premiere requete, CloudFront va chercher le contenu a l'origin (cache miss). Ensuite, toutes les requetes suivantes depuis la meme region sont servies directement depuis le edge (cache hit).

---

## Distributions CloudFront

### Creer une distribution

Une **distribution** est la ressource principale de CloudFront. Elle definit :

- **L'origin** : d'ou vient le contenu
- **Les cache behaviors** : comment gerer les requetes
- **Le domaine** : `d1234abcd.cloudfront.net` (ou un domaine custom)

### Types d'origins

CloudFront peut servir du contenu depuis plusieurs types de sources :

#### 1. Origin S3

Le cas le plus courant — servir des fichiers statiques depuis un bucket S3 :

```
Distribution CloudFront
  └── Origin: mon-bucket.s3.eu-west-1.amazonaws.com
        └── /images/logo.png
        └── /css/style.css
        └── /index.html
```

#### 2. Origin ALB (Application Load Balancer)

Pour du contenu dynamique genere par des serveurs applicatifs :

```
Distribution CloudFront
  └── Origin: mon-alb-123456.eu-west-1.elb.amazonaws.com
        └── /api/users
        └── /api/products
```

#### 3. Origin custom (HTTP)

N'importe quel serveur accessible via HTTP/HTTPS :

```
Distribution CloudFront
  └── Origin: api.mon-site.com (port 443)
```

#### 4. Origins multiples

Une meme distribution peut avoir plusieurs origins avec des **behaviors** differents :

```
Distribution CloudFront
  ├── /api/*     → ALB (contenu dynamique)
  ├── /media/*   → S3 bucket media
  └── /*         → S3 bucket site statique (default)
```

---

## Cache Behaviors

### Qu'est-ce qu'un cache behavior ?

Un **cache behavior** est une regle qui dit a CloudFront **comment traiter** les requetes correspondant a un certain pattern d'URL.

### Configuration d'un behavior

Chaque behavior definit :

| Parametre | Description | Exemple |
|-----------|-------------|---------|
| **Path pattern** | Quel chemin URL correspond | `/api/*`, `/images/*`, `*` (default) |
| **Origin** | Vers quelle origin router | S3, ALB, custom |
| **Viewer protocol** | HTTP et/ou HTTPS | Redirect HTTP to HTTPS |
| **Cache policy** | Comment mettre en cache | TTL, headers, query strings |
| **Allowed methods** | GET, POST, PUT, DELETE... | GET/HEAD pour statique |
| **Compress** | Activer la compression gzip/brotli | Oui pour texte/JS/CSS |

### Ordre d'evaluation

CloudFront evalue les behaviors **du plus specifique au plus general** :

```
1. /api/v2/*        → ALB (pas de cache)
2. /api/*           → ALB (cache 60s)
3. /static/*        → S3 (cache 1 an)
4. *.jpg            → S3 (cache 30 jours)
5. * (default)      → S3 site (cache 1 jour)
```

Le premier pattern qui correspond est utilise.

---

## TTL et politique de cache

### Qu'est-ce que le TTL ?

Le **TTL** (Time To Live) est la duree pendant laquelle CloudFront garde un objet en cache avant de le re-verifier aupres de l'origin.

### Les trois niveaux de TTL

```
Minimum TTL ≤ Default TTL ≤ Maximum TTL
```

| Parametre | Role | Valeur typique |
|-----------|------|----------------|
| **Minimum TTL** | Duree minimale en cache, meme si l'origin dit moins | 0s |
| **Default TTL** | Utilise quand l'origin ne specifie pas de Cache-Control | 86400s (1 jour) |
| **Maximum TTL** | Plafond, meme si l'origin dit plus | 31536000s (1 an) |

### Headers de cache de l'origin

L'origin peut controler le cache via des headers HTTP :

```
Cache-Control: max-age=3600          → cache 1h
Cache-Control: no-cache              → toujours revalider
Cache-Control: no-store              → ne jamais cacher
Cache-Control: s-maxage=600          → cache CDN 10min (prioritaire sur max-age)
```

### Cache Key

La **cache key** determine ce qui rend deux requetes "differentes" pour le cache. Par defaut, c'est le **chemin URL** + **query strings** (selon config).

Exemple : `/products?page=1` et `/products?page=2` sont deux entrees de cache differentes.

Vous pouvez inclure dans la cache key :
- Des **query strings** specifiques
- Des **headers** (ex : `Accept-Language` pour du contenu multilingue)
- Des **cookies** specifiques

**Bonne pratique** : inclure le minimum necessaire dans la cache key pour maximiser le taux de cache hit.

---

## Invalidation de cache

### Pourquoi invalider ?

Vous avez deploye une nouvelle version de votre site, mais CloudFront sert encore l'ancienne version depuis son cache. Vous devez **invalider** le cache pour forcer CloudFront a aller chercher le nouveau contenu.

### Creer une invalidation

```bash
# Invalider un fichier specifique
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/index.html"

# Invalider un repertoire entier
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/css/*"

# Invalider TOUT le cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/*"
```

### Cout et limites

- Les **1 000 premiers chemins** par mois sont gratuits
- Au-dela : $0.005 par chemin
- Un wildcard (`/*`) compte comme **un seul chemin**
- L'invalidation prend generalement **60 a 300 secondes**

### Alternative : versionner les fichiers

Plutot que d'invalider, une meilleure pratique est de **versionner** les noms de fichiers :

```
/css/style.v1.css  → ancienne version
/css/style.v2.css  → nouvelle version (nouvelle URL = nouveau cache)
```

Ou avec des hashes :

```
/js/app.a3f5b2c.js  → le hash change a chaque build
```

Ainsi, chaque nouvelle version a une URL unique et pas besoin d'invalidation.

---

## OAC — Origin Access Control

### Le probleme

Si votre bucket S3 est public pour que CloudFront puisse y acceder, alors n'importe qui peut acceder directement au bucket en contournant CloudFront. On perd le controle du cache, les metriques et la securite.

### La solution : OAC

**OAC** (Origin Access Control) est le mecanisme **recommande** (remplace l'ancien OAI — Origin Access Identity) pour securiser l'acces S3 via CloudFront.

Principe : le bucket S3 reste **prive**, et seul CloudFront est autorise a y acceder via une **signature SigV4**.

### Comment ca fonctionne

```
Utilisateur → CloudFront (signe la requete avec SigV4) → S3 prive
                                                           ↓
                                                    Bucket policy verifie
                                                    la signature CloudFront
```

### Bucket policy avec OAC

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::mon-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1234567890"
        }
      }
    }
  ]
}
```

### OAC vs OAI

| Critere | OAI (ancien) | OAC (recommande) |
|---------|-------------|-------------------|
| Signature | Identite speciale | SigV4 standard |
| SSE-KMS | Non supporte | Supporte |
| Toutes regions | Non | Oui |
| Granularite | Par distribution | Par origin |

**Utilisez toujours OAC** pour les nouvelles distributions.

---

## Lambda@Edge vs CloudFront Functions

### Edge computing avec CloudFront

CloudFront permet d'executer du code **au edge**, c'est-a-dire directement sur les serveurs de cache. Deux options existent :

### CloudFront Functions

- **Langage** : JavaScript (ECMAScript 5.1)
- **Duree max** : 1 ms
- **Memoire** : 2 Mo
- **Acces reseau** : Non
- **Prix** : ~$0.10 par million d'invocations
- **Points d'execution** : Viewer Request, Viewer Response

**Cas d'usage** : manipulations legeres de requetes/reponses :
- Reecriture d'URL (`/about` → `/about/index.html`)
- Ajout de headers de securite (HSTS, CSP)
- Redirection HTTP → HTTPS
- Validation de tokens simples

Exemple — ajouter des headers de securite :

```javascript
function handler(event) {
  var response = event.response;
  var headers = response.headers;

  headers['strict-transport-security'] = {
    value: 'max-age=63072000; includeSubdomains; preload'
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'DENY' };

  return response;
}
```

### Lambda@Edge

- **Langages** : Node.js, Python
- **Duree max** : 5s (viewer) / 30s (origin)
- **Memoire** : 128 Mo — 10 Go
- **Acces reseau** : Oui (appels API, DynamoDB...)
- **Prix** : ~$0.60 par million + duree
- **Points d'execution** : Viewer Request, Viewer Response, Origin Request, Origin Response

**Cas d'usage** : logique plus complexe :
- A/B testing (routage vers differentes origines)
- Authentification (verification JWT, OAuth)
- Generation de contenu dynamique au edge
- Redimensionnement d'images a la volee

### Les 4 points d'execution

```
Client → [Viewer Request] → Cache CloudFront → [Origin Request] → Origin
                                                                      |
Client ← [Viewer Response] ← Cache CloudFront ← [Origin Response] ← ┘
```

| Point | Quand | Cas d'usage |
|-------|-------|-------------|
| **Viewer Request** | Avant le cache | Auth, reecriture URL, redirections |
| **Origin Request** | Si cache miss, avant origin | A/B testing, routage dynamique |
| **Origin Response** | Reponse de l'origin | Ajout headers, transformation |
| **Viewer Response** | Avant envoi au client | Headers securite, CORS |

---

## Custom Error Pages

### Personnaliser les erreurs

CloudFront peut intercepter les codes d'erreur de l'origin et retourner une page personnalisee :

```
Origin retourne 404
       ↓
CloudFront intercepte
       ↓
Retourne /error/404.html depuis S3 avec code 404
```

### Configuration des custom error responses

| Parametre | Description |
|-----------|-------------|
| **Error Code** | Le code HTTP de l'origin (403, 404, 500...) |
| **Response Page Path** | Le chemin vers la page d'erreur (`/error/404.html`) |
| **Response Code** | Le code HTTP retourne au client (peut etre different) |
| **Error Caching TTL** | Combien de temps cacher cette erreur |

### Cas courant : SPA (Single Page Application)

Pour une SPA, toutes les routes doivent retourner `index.html` :

```
Configuration custom error :
  Error Code: 403 → Response: /index.html, Code: 200
  Error Code: 404 → Response: /index.html, Code: 200
```

Ainsi, quand un utilisateur accede a `/dashboard/settings`, S3 retourne 404 (le fichier n'existe pas), mais CloudFront retourne `index.html` avec un code 200, et le routeur JavaScript de la SPA gere la navigation.

---

## Geo-restriction

### Restreindre l'acces par pays

CloudFront peut **bloquer ou autoriser** l'acces en fonction du pays de l'utilisateur, determine par son adresse IP.

### Deux modes

| Mode | Description |
|------|-------------|
| **Allow list** | Seuls les pays listes peuvent acceder |
| **Block list** | Les pays listes sont bloques |

### Cas d'usage

- **Conformite reglementaire** : contenu restreint a certains pays (ex : droits de diffusion video)
- **Restrictions legales** : bloquer les pays sous embargo
- **Licences logicielles** : limiter la distribution par region

### Comportement

Quand un utilisateur bloque tente d'acceder au contenu, CloudFront retourne une erreur **403 Forbidden**. Vous pouvez combiner cela avec une custom error page pour afficher un message explicatif.

---

## Signed URLs et Signed Cookies

### Contenu prive via CloudFront

Pour distribuer du contenu prive (videos payantes, documents confidentiels), CloudFront offre deux mecanismes :

### Signed URLs

Une **signed URL** est une URL temporaire qui contient une signature cryptographique. Elle expire apres un delai defini.

```
https://d1234.cloudfront.net/video/premium.mp4
  ?Policy=eyJ...                    ← politique encodee
  &Signature=A2b3c4...             ← signature RSA
  &Key-Pair-Id=K1234ABCDEF         ← identifiant de la cle
```

**Cas d'usage** : un fichier specifique pour un utilisateur specifique.

### Signed Cookies

Les **signed cookies** permettent l'acces a **plusieurs fichiers** sans modifier les URLs.

**Cas d'usage** : acces a un repertoire entier (ex : tous les episodes d'une serie).

### Comparaison

| Critere | Signed URL | Signed Cookie |
|---------|-----------|---------------|
| Granularite | Un fichier | Plusieurs fichiers |
| URL modifiee | Oui | Non |
| RTMP streaming | Supporte | Non |
| Cas d'usage | Telechargement unique | Acces a une section entiere |

### Cle de signature

Les signed URLs/cookies utilisent une paire de cles RSA :
1. Vous generez une **paire de cles** RSA (publique/privee)
2. Vous uploadez la **cle publique** dans CloudFront (Key Group)
3. Votre serveur signe les URLs avec la **cle privee**
4. CloudFront verifie la signature avec la cle publique

---

## HTTP/2 et HTTP/3

### HTTP/2 (active par defaut)

CloudFront supporte HTTP/2, qui apporte :
- **Multiplexage** : plusieurs requetes sur une seule connexion TCP
- **Server Push** : envoyer des ressources avant que le client les demande
- **Compression des headers** : HPACK reduit la taille des headers
- **Priorisation** : les ressources critiques sont envoyees en premier

### HTTP/3 (QUIC)

HTTP/3 utilise **QUIC** (base sur UDP) au lieu de TCP :
- **Connexion plus rapide** : 0-RTT handshake (pas de triple handshake TCP)
- **Pas de head-of-line blocking** : une perte de paquet ne bloque pas les autres streams
- **Migration de connexion** : le client peut changer d'IP sans reconnexion (mobile)

HTTP/3 est optionnel et s'active dans les parametres de la distribution. Le client negocie automatiquement la meilleure version supportee.

---

## Price Classes

### Optimiser les couts

CloudFront est present dans **450+ PoP** dans le monde, mais tous les edge locations n'ont pas le meme prix. Les **price classes** permettent de limiter les regions utilisees pour reduire les couts.

| Price Class | Regions incluses | Cout relatif |
|-------------|-----------------|--------------|
| **Price Class All** | Toutes (y compris Amerique du Sud, Afrique) | Le plus cher |
| **Price Class 200** | USA, Europe, Asie, Moyen-Orient, Afrique | Intermediaire |
| **Price Class 100** | USA, Europe | Le moins cher |

### Quel impact ?

Si vous choisissez Price Class 100 et qu'un utilisateur au Bresil accede a votre site :
- Le contenu sera servi depuis le PoP **le plus proche dans les regions incluses** (probablement USA)
- La latence sera plus elevee pour cet utilisateur
- Mais le cout sera reduit

**Recommandation** : utilisez Price Class All pour une audience mondiale, Price Class 100 pour une audience principalement europeenne/americaine.

---

## Route 53, DNS et certificats ACM

Pour servir votre app sur un domaine personnalisé (ex: `app.example.com`), vous avez besoin de 3 services AWS qui fonctionnent ensemble.

### Route 53 — DNS managé

Route 53 est le service DNS d'AWS. Il gère les **hosted zones** (domaines) et les **records** (enregistrements DNS).

```
example.com (Hosted Zone)
├── A     app.example.com    → CloudFront distribution
├── AAAA  app.example.com    → CloudFront distribution (IPv6)
├── CNAME api.example.com    → ALB ou API Gateway
└── MX    example.com        → Service email
```

**ALIAS records** : spécificité AWS — comme un CNAME mais fonctionne à la racine du domaine (`example.com`) et ne coûte rien en requêtes DNS.

### ACM — Certificats TLS gratuits

AWS Certificate Manager fournit des certificats TLS **gratuits** avec renouvellement automatique.

```bash
# Créer un certificat via CLI
aws acm request-certificate \
  --domain-name "*.example.com" \
  --subject-alternative-names "example.com" \
  --validation-method DNS \
  --region us-east-1  # OBLIGATOIRE pour CloudFront
```

**Important** : les certificats pour CloudFront **doivent** être créés dans `us-east-1`, même si votre app est en `eu-west-1`.

Validation DNS : ACM vous donne un record CNAME à ajouter à votre hosted zone. Une fois validé, le certificat est émis et renouvelé automatiquement.

### Workflow complet : domaine → CloudFront

```
1. Acheter/transférer le domaine vers Route 53
2. Créer un certificat ACM dans us-east-1 (wildcard *.example.com)
3. Valider le certificat via DNS (ajouter le CNAME dans Route 53)
4. Configurer CloudFront avec le certificat ACM et les alternate domain names
5. Créer un ALIAS record dans Route 53 pointant vers la distribution CloudFront
```

### Exemple CDK

```typescript
import { HostedZone, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';

// Récupérer la hosted zone existante
const zone = HostedZone.fromLookup(this, 'Zone', {
  domainName: 'example.com',
});

// Certificat TLS (cross-region pour CloudFront)
const certificate = new Certificate(this, 'Cert', {
  domainName: '*.example.com',
  subjectAlternativeNames: ['example.com'],
  validation: CertificateValidation.fromDns(zone),
});

// Distribution CloudFront avec le certificat
const distribution = new Distribution(this, 'CDN', {
  defaultBehavior: { origin: s3Origin },
  domainNames: ['app.example.com'],
  certificate,
});

// Record DNS pointant vers CloudFront
new ARecord(this, 'AppRecord', {
  zone,
  recordName: 'app',
  target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
});
```

---

## Bonnes pratiques

### Performance
- Activez la **compression** (gzip/brotli) pour les fichiers texte
- Utilisez des **TTL longs** pour les assets statiques versionnees
- Activez **HTTP/3** pour les clients mobiles
- Minimisez la **cache key** (moins de variations = plus de cache hits)

### Securite
- Utilisez **OAC** pour securiser les origins S3
- Forcez **HTTPS** (redirect HTTP to HTTPS)
- Ajoutez des **headers de securite** via CloudFront Functions
- Utilisez des **signed URLs/cookies** pour le contenu prive

### Cout
- Choisissez la **price class** adaptee a votre audience
- **Versionnez les fichiers** au lieu d'invalider le cache
- Monitorer le **cache hit ratio** (objectif : > 90%)
- Utilisez **CloudFront Functions** plutot que Lambda@Edge quand possible

### Monitoring
- **Cache hit ratio** : pourcentage de requetes servies depuis le cache
- **Error rate** : taux d'erreurs 4xx/5xx
- **Latence** : temps de reponse au edge
- **Transfer out** : volume de donnees servies (impact sur la facturation)

---

## Recapitulatif

| Concept | A retenir |
|---------|-----------|
| **CDN** | Cache le contenu au plus pres des utilisateurs |
| **Distribution** | Configuration CloudFront (origins + behaviors) |
| **Cache Behavior** | Regle par pattern URL (origin, TTL, methodes) |
| **OAC** | Securise l'acces S3 via signature SigV4 |
| **Invalidation** | Force le rafraichissement du cache (preferer le versioning) |
| **CloudFront Functions** | Code leger au edge (< 1ms, JS) |
| **Lambda@Edge** | Code complexe au edge (Node.js/Python, acces reseau) |
| **Signed URL/Cookie** | Distribution de contenu prive temporaire |
| **Price Class** | Limiter les regions pour reduire les couts |
