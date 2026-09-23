// module 00 §2.4 : jamais le root, un profil CLI nommé, région Paris (RGPD).
provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = local.tags
  }
}
