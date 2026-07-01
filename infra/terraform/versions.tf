terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local for now. Move to an S3 backend + DynamoDB lock before any
  # shared/CI use (S3 is pennies; add when a second operator appears).
}
