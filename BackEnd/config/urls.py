
from django.contrib import admin
from django.urls import path, re_path
from django.conf import settings
from django.views.static import serve
from Migrator import views

def serve_angular(request, path=""):
    clean_path = path.lstrip("/")
    if clean_path:
        target_file = settings.ANGULAR_DIST_DIR / clean_path
        if target_file.exists() and target_file.is_file():
            return serve(request, clean_path, document_root=str(settings.ANGULAR_DIST_DIR))
    return serve(request, "index.html", document_root=str(settings.ANGULAR_DIST_DIR))

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/scan/", views.Db_Scanner),
    path("api/scan-status/<uuid:scan_id>/", views.scan_status),
    path("api/connect/", views.connect_database),
    path("api/connect-fabric/", views.connect_fabric),
    path("api/extract-metadata/", views.extract_metadata),
    path("api/validate-constraints/", views.validate_constraints),
    path("api/assessment-report/", views.generate_assessment),
    path("api/migration-plan/", views.generate_migration_plan_view),
    path("api/pipeline-state/", views.pipeline_state),
    path("api/connection/", views.saved_connection),
    path("api/connections/", views.saved_connections),
    path("api/debug/", views.debug_view),
    path("api/generate-fabric-artifacts/", views.generate_fabric_artifacts),
    path("api/er-diagram/", views.er_diagram),
    path("output/<str:filename>", views.serve_generated_document, name="generated-document"),
    re_path(r"^(?P<path>.*)$", serve_angular),
]