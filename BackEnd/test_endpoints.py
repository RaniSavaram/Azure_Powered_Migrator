import os
import sys
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from rest_framework.test import APIClient
import json

client = APIClient()

print("=" * 60)
print("TESTING PHASE_1 MODULAR BACKEND ENDPOINTS")
print("=" * 60)

# 1. Connect
print("\n[1] Testing /api/connect/ ...")
res = client.post("/api/connect/", {
    "source": "SQL Server",
    "server": "localhost",
    "database": "AdventureWorks",
    "user": "sa",
    "password": "Password123"
}, format="json")
print(f"Status: {res.status_code}, Response: {res.data.get('status')} - {res.data.get('message')}")
assert res.status_code == 200

# 2. Extract Metadata
print("\n[2] Testing /api/extract-metadata/ ...")
res = client.post("/api/extract-metadata/", {}, format="json")
print(f"Status: {res.status_code}")
tables_count = len(res.data.get("tables", []))
print(f"Extracted tables count: {tables_count}")
print(f"Total rows estimate: {res.data.get('summary', {}).get('total_rows')}")
assert res.status_code == 200
assert tables_count > 0

# 3. Validate Constraints
print("\n[3] Testing /api/validate-constraints/ ...")
res = client.get("/api/validate-constraints/")
print(f"Status: {res.status_code}")
print(f"Constraints status: {res.data.get('status')}")
print(f"Rules evaluated: {len(res.data.get('rules', []))}")
assert res.status_code == 200
assert res.data.get("status") == "success"

# 4. Assessment Report
print("\n[4] Testing /api/assessment-report/ ...")
res = client.get("/api/assessment-report/")
print(f"Status: {res.status_code}")
print(f"Report status: {res.data.get('status')}")
print(f"Docx file: {res.data.get('report_file')}")
breakdown = res.data.get("summary", {}).get("complexity_breakdown", {})
print(f"Simple/Medium/Complex: {breakdown.get('simple')}/{breakdown.get('medium')}/{breakdown.get('complex')}")
assert res.status_code == 200
assert res.data.get("report_file") is not None

# 5. Migration Plan
print("\n[5] Testing /api/migration-plan/ ...")
res = client.get("/api/migration-plan/")
print(f"Status: {res.status_code}")
print(f"Plan status: {res.data.get('status')}")
print(f"Waves: {len(res.data.get('execution_waves', []))}")
print(f"Docx file: {res.data.get('plan_file')}")
assert res.status_code == 200
assert res.data.get("plan_file") is not None

# 6. Pipeline State
print("\n[6] Testing /api/pipeline-state/ ...")
res = client.get("/api/pipeline-state/")
print(f"Status: {res.status_code}")
print(f"Pipeline active source: {res.data.get('platform')}")
print(f"Has metadata: {res.data.get('has_metadata')}")
print(f"Has assessment: {res.data.get('has_assessment')}")
print(f"Has migration plan: {res.data.get('has_migration_plan')}")
assert res.status_code == 200
assert res.data.get("has_metadata") is True

# 7. ER Diagram
print("\n[7] Testing /api/er-diagram/ ...")
res = client.get("/api/er-diagram/")
print(f"Status: {res.status_code}")
print(f"Entities: {len(res.data.get('entities', []))}")
print(f"Relationships: {len(res.data.get('relationships', []))}")
assert res.status_code == 200
assert len(res.data.get("entities", [])) > 0

# 8. Serve Generated Document
print("\n[8] Testing /output/<filename> ...")
res_doc = client.get("/output/Fabric_Migration_Metadata.json")
print(f"Status for /output/Fabric_Migration_Metadata.json: {res_doc.status_code}")
assert res_doc.status_code == 200

print("\n" + "=" * 60)
print("ALL 8 ENDPOINTS PASSED WITH FLYING COLORS!")
print("=" * 60)
