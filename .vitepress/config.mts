import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'AWS Cloud Course',
  description: 'Formation complète AWS Cloud : de zéro à l\'architecture cloud professionnelle',
  lang: 'fr-FR',
  srcDir: '.',

  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-prerequis-et-vue-ensemble' },
      { text: 'Labs', link: '/labs/lab-00-aws-fundamentals/' },
      { text: 'Quizzes', link: '/quizzes/' },
      { text: 'Glossaire', link: '/glossaire' },
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Palier 1 — Fondations Cloud',
          collapsed: false,
          items: [
            { text: '00 — Prérequis & Vue d\'ensemble', link: '/modules/00-prerequis-et-vue-ensemble' },
            { text: '01 — IAM', link: '/modules/01-iam-identity-access' },
            { text: '02 — VPC & Networking', link: '/modules/02-vpc-networking' },
            { text: '03 — EC2 Compute', link: '/modules/03-ec2-compute' },
            { text: '04 — S3 Object Storage', link: '/modules/04-s3-stockage-objets' },
          ],
        },
        {
          text: 'Palier 2 — IaC, Serverless & APIs',
          collapsed: false,
          items: [
            { text: '05 — CDK (IaC)', link: '/modules/05-cdk-infrastructure-code' },
            { text: '06 — Lambda Serverless', link: '/modules/06-lambda-serverless' },
            { text: '07 — API Gateway', link: '/modules/07-api-gateway' },
            { text: '08 — RDS & ElastiCache', link: '/modules/08-rds-elasticache' },
            { text: '09 — DynamoDB', link: '/modules/09-dynamodb' },
          ],
        },
        {
          text: 'Palier 3 — Messaging, Auth & Containers',
          collapsed: false,
          items: [
            { text: '10 — SQS, SNS & EventBridge', link: '/modules/10-messaging-evenements' },
            { text: '11 — Cognito Auth', link: '/modules/11-cognito-authentification' },
            { text: '12 — ECS & Fargate', link: '/modules/12-ecs-fargate-containers' },
            { text: '13 — CloudFront CDN', link: '/modules/13-cloudfront-cdn' },
            { text: '14 — CloudWatch & X-Ray', link: '/modules/14-cloudwatch-xray-observabilite' },
          ],
        },
        {
          text: 'Palier 4 — Production & Deploy',
          collapsed: false,
          items: [
            { text: '15 — Sécurité Avancée', link: '/modules/15-securite-aws-avancee' },
            { text: '16 — Architectures Serverless', link: '/modules/16-architectures-serverless' },
            { text: '17 — CI/CD & DevOps', link: '/modules/17-cicd-devops' },
            { text: '18 — Projet Final', link: '/modules/18-projet-final-architecture-cloud' },
            { text: '19 — Deployer Nuxt/Next sur AWS', link: '/modules/19-deployer-nuxt-next-aws' },
          ],
        },
      ],

      '/labs/': [
        {
          text: 'Palier 1 — Fondations Cloud',
          collapsed: false,
          items: [
            { text: 'Lab 00 — AWS Fundamentals', link: '/labs/lab-00-aws-fundamentals/' },
            { text: 'Lab 01 — IAM', link: '/labs/lab-01-iam/' },
            { text: 'Lab 02 — VPC', link: '/labs/lab-02-vpc/' },
            { text: 'Lab 03 — EC2', link: '/labs/lab-03-ec2/' },
            { text: 'Lab 04 — S3', link: '/labs/lab-04-s3/' },
          ],
        },
        {
          text: 'Palier 2 — IaC, Serverless & APIs',
          collapsed: false,
          items: [
            { text: 'Lab 05 — CDK', link: '/labs/lab-05-cdk-constructs/' },
            { text: 'Lab 06 — Lambda', link: '/labs/lab-06-lambda/' },
            { text: 'Lab 07 — API Gateway', link: '/labs/lab-07-api-gateway/' },
            { text: 'Lab 08 — RDS/ElastiCache', link: '/labs/lab-08-rds-elasticache/' },
            { text: 'Lab 09 — DynamoDB', link: '/labs/lab-09-dynamodb/' },
          ],
        },
        {
          text: 'Palier 3 — Messaging, Auth & Containers',
          collapsed: false,
          items: [
            { text: 'Lab 10 — Messaging', link: '/labs/lab-10-messaging/' },
            { text: 'Lab 11 — Cognito', link: '/labs/lab-11-cognito/' },
            { text: 'Lab 12 — ECS/Fargate', link: '/labs/lab-12-ecs-containers/' },
            { text: 'Lab 13 — CloudFront', link: '/labs/lab-13-cloudfront-cdn/' },
            { text: 'Lab 14 — CloudWatch', link: '/labs/lab-14-cloudwatch-observability/' },
          ],
        },
        {
          text: 'Palier 4 — Production & Deploy',
          collapsed: false,
          items: [
            { text: 'Lab 15 — Sécurité', link: '/labs/lab-15-security/' },
            { text: 'Lab 16 — Serverless Architecture', link: '/labs/lab-16-serverless-architecture/' },
            { text: 'Lab 17 — CI/CD', link: '/labs/lab-17-cicd/' },
            { text: 'Lab 18 — Projet Final', link: '/labs/lab-18-projet-final/' },
            { text: 'Lab 19 — Deploy Nuxt/Next', link: '/labs/lab-19-deploy-nuxt-next/' },
          ],
        },
      ],

      '/quizzes/': [
        {
          text: 'Quizzes',
          items: [
            { text: 'Quiz 00 — Prérequis', link: '/quizzes/quiz-00-prerequis' },
            { text: 'Quiz 01 — IAM', link: '/quizzes/quiz-01-iam' },
            { text: 'Quiz 02 — VPC', link: '/quizzes/quiz-02-vpc' },
            { text: 'Quiz 03 — EC2', link: '/quizzes/quiz-03-ec2' },
            { text: 'Quiz 04 — S3', link: '/quizzes/quiz-04-s3' },
            { text: 'Quiz 05 — CDK', link: '/quizzes/quiz-05-cdk' },
            { text: 'Quiz 06 — Lambda', link: '/quizzes/quiz-06-lambda' },
            { text: 'Quiz 07 — API Gateway', link: '/quizzes/quiz-07-api-gateway' },
            { text: 'Quiz 08 — RDS/ElastiCache', link: '/quizzes/quiz-08-rds-elasticache' },
            { text: 'Quiz 09 — DynamoDB', link: '/quizzes/quiz-09-dynamodb' },
            { text: 'Quiz 10 — Messaging', link: '/quizzes/quiz-10-messaging' },
            { text: 'Quiz 11 — Cognito', link: '/quizzes/quiz-11-cognito' },
            { text: 'Quiz 12 — ECS/Fargate', link: '/quizzes/quiz-12-ecs-fargate' },
            { text: 'Quiz 13 — CloudFront', link: '/quizzes/quiz-13-cloudfront' },
            { text: 'Quiz 14 — CloudWatch', link: '/quizzes/quiz-14-cloudwatch' },
            { text: 'Quiz 15 — Sécurité', link: '/quizzes/quiz-15-securite' },
            { text: 'Quiz 16 — Serverless Avancé', link: '/quizzes/quiz-16-serverless-avance' },
            { text: 'Quiz 17 — CI/CD', link: '/quizzes/quiz-17-cicd' },
            { text: 'Quiz 18 — Projet Final', link: '/quizzes/quiz-18-projet-final' },
            { text: 'Quiz 19 — Deploy Nuxt/Next', link: '/quizzes/quiz-19-deployer-nuxt-next' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: 'Sur cette page',
    },

    docFooter: {
      prev: 'Précédent',
      next: 'Suivant',
    },
  },
});
