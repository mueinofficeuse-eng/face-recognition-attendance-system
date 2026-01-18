# getRecentAttendance

```python
import boto3
import json
from decimal import Decimal

# Helper to handle Decimal types in JSON
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

# EXPLICITLY set the region
dynamodb = boto3.resource('dynamodb', region_name='ap-south-1')

def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    }

    try:
        # 1. Connect to table
        table = dynamodb.Table('Attendance')
        
        # 2. Get latest records
        response = table.scan(Limit=20)
        items = response.get('Items', [])

        # 3. Sort by timestamp (latest first)
        items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)

        return {
            'statusCode': 200,
            'headers': headers,
            # CRITICAL: Use the DecimalEncoder here
            'body': json.dumps(items, cls=DecimalEncoder)
        }

    except Exception as e:
        print(f"ERROR: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': str(e)})
        }
```

# registerEmployees

```python
import boto3
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client('s3')
rekognition = boto3.client('rekognition')
dynamodb = boto3.resource('dynamodb')

EMPLOYEE_BUCKET = 'face-attendance-employees'
COLLECTION_ID = 'employee'
EMPLOYEE_TABLE = dynamodb.Table('Employees')

def lambda_handler(event, context):

    response = s3.list_objects_v2(Bucket=EMPLOYEE_BUCKET)

    if 'Contents' not in response:
        return {'Message': 'No employee images found'}

    registered = []
    skipped = []

    for obj in response['Contents']:
        key = obj['Key']

        if key.endswith('/'):
            continue

        try:
            filename = os.path.basename(key)
            name, _ = os.path.splitext(filename)

            # ✅ SAFELY split filename
            parts = name.split('_', 1)
            if len(parts) != 2:
                logger.warning(f"Invalid filename format: {filename}")
                skipped.append(key)
                continue

            employee_id, employee_name = parts

            # ✅ Index face into Rekognition
            rek = rekognition.index_faces(
                CollectionId=COLLECTION_ID,
                Image={'S3Object': {'Bucket': EMPLOYEE_BUCKET, 'Name': key}},
                ExternalImageId=employee_id,
                DetectionAttributes=[]
            )

            if not rek.get('FaceRecords'):
                skipped.append(key)
                continue

            face = rek['FaceRecords'][0]['Face']
            face_id = face['FaceId']

            # ✅ Store in DynamoDB
            EMPLOYEE_TABLE.put_item(
                Item={
                    'employeeId': employee_id,          # PK
                    'rekognitionFaceId': face_id,       # SK
                    'employeeName': employee_name
                }
            )

            registered.append(employee_id)

        except Exception as e:
            logger.error(f"Error processing {key}: {str(e)}")
            skipped.append(key)

    return {
        'Message': 'Employee registration completed',
        'Registered': registered,
        'Skipped': skipped
    }
```

# getUploadUrl

```python
import boto3
import json
import uuid

s3 = boto3.client('s3', region_name='ap-south-1')
# Using your visitor bucket name
BUCKET = 'face-attendance-visitors'

def lambda_handler(event, context):
    # Support for CORS
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    }

    # Handle OPTIONS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers}

    # Generate a unique filename for the selfie
    object_key = f"checkin_{uuid.uuid4().hex}.jpg"

    # Generate the URL for the 'face-attendance-visitors' bucket
    url = s3.generate_presigned_url(
        'put_object',
        Params={
            'Bucket': BUCKET,
            'Key': object_key,
            'ContentType': 'image/jpeg'
        },
        ExpiresIn=300
    )

    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({
            'uploadUrl': url, 
            'fileName': object_key
        })
    }
```

# markAttendance

```python
import boto3
import json
from datetime import datetime
from decimal import Decimal

# AWS clients
rekognition = boto3.client('rekognition', region_name='ap-south-1')
dynamodb = boto3.resource('dynamodb', region_name='ap-south-1')
s3 = boto3.client('s3', region_name='ap-south-1')

# Configuration
VISITOR_BUCKET = 'face-attendance-visitors'
COLLECTION_ID = 'employee'
ATTENDANCE_TABLE = 'Attendance'

def lambda_handler(event, context):

    # CORS headers
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
    }

    # Handle preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers
        }

    # -------------------------------
    # SAFE BODY PARSING (CRITICAL FIX)
    # -------------------------------
    if 'body' in event and event['body']:
        body = json.loads(event['body'])
    else:
        body = event

    image_name = body.get('imageName')

    if not image_name:
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'imageName missing'})
        }

    # --------------------------------
    # CHECK IF IMAGE EXISTS IN S3
    # --------------------------------
    try:
        s3.head_object(Bucket=VISITOR_BUCKET, Key=image_name)
    except Exception:
        return {
            'statusCode': 400,
            'headers': headers,
            'body': json.dumps({'error': 'Image not found in S3'})
        }

    # --------------------------------
    # REKOGNITION FACE SEARCH
    # --------------------------------
    response = rekognition.search_faces_by_image(
        CollectionId=COLLECTION_ID,
        Image={
            'S3Object': {
                'Bucket': VISITOR_BUCKET,
                'Name': image_name
            }
        },
        FaceMatchThreshold=80,
        MaxFaces=1
    )

    # Debug log (VERY useful)
    print("Rekognition response:", json.dumps(response, indent=2))

    matches = response.get('FaceMatches', [])

    if not matches:
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'attendanceMarked': False})
        }

    # --------------------------------
    # EXTRACT MATCH DETAILS
    # --------------------------------
    face = matches[0]['Face']
    employee_id = face['ExternalImageId']
    confidence = matches[0]['Similarity']

    # --------------------------------
    # STORE ATTENDANCE IN DYNAMODB
    # --------------------------------
    date = datetime.utcnow().strftime('%Y-%m-%d%H:%M:%S')

    table = dynamodb.Table(ATTENDANCE_TABLE)
    table.put_item(
        Item={
            'employeeId': employee_id,              # Partition Key
            'timestamp': date,                      # Sort Key
            'status': 'PRESENT',
            'confidence': Decimal(str(confidence))  # ✅ Decimal FIX
        }
    )

    # --------------------------------
    # SUCCESS RESPONSE
    # --------------------------------
    return {
        'statusCode': 200,
        'headers': headers,
        'body': json.dumps({
            'attendanceMarked': True,
            'employeeId': employee_id,
            'confidence': confidence
        })
    }
```
