// module 04 (S3) : bucket privé, jamais public directement — CloudFront y accède via OAC
// (Origin Access Control), pas via une politique publique sur le bucket lui-même.
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "static" {
  bucket = "${var.project_name}-${var.environment}-static-${random_id.bucket_suffix.hex}"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket                  = aws_s3_bucket.static.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "index" {
  bucket       = aws_s3_bucket.static.id
  key          = "index.html"
  source       = "${path.module}/../app/static/index.html"
  content_type = "text/html"
  etag         = filemd5("${path.module}/../app/static/index.html")
}
