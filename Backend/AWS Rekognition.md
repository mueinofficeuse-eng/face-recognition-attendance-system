# AWS Rekognition Collection Setup

To create the Rekognition collection used by the Attendance system, run the following command using the AWS CLI.

## Create Collection Command

```bash
aws rekognition create-collection --collection-id "employee" --region ap-south-1
```

## List Collections
To see all Rekognition collections in your current region:

```bash
aws rekognition list-collections --region ap-south-1
```

## List Faces in Collection
To see the faces indexed within the "employee" collection:

```bash
aws rekognition list-faces --collection-id "employee" --region ap-south-1
```

## Delete Collection (Optional)
If you need to restart or rename the collection:

```bash
aws rekognition delete-collection --collection-id "employee" --region ap-south-1
```
