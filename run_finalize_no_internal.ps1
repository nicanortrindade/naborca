$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY"
    "apikey"        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZWJpcnlxZnFoZXlhend0enptIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODYxMjgzNCwiZXhwIjoyMDg0MTg4ODM0fQ.M9lbGXK5AZAbviHKTrBgZ3I56WxYN6LTNCa57Cj8udY"
}

$body = @{
    job_id                     = "4bc3e5fc-fd8b-4f1b-bb32-cdf141f68cff"
    force_rehydrate            = $true
    uf                         = "BA"
    desonerado                 = $false
    enable_structure_parser_v1 = $true
} | ConvertTo-Json

Invoke-WebRequest `
    -Uri "https://cgebiryqfqheyazwtzzm.supabase.co/functions/v1/import-finalize-budget" `
    -Method POST `
    -Headers $headers `
    -Body $body `
    -TimeoutSec 600 | Select-Object -ExpandProperty Content | Out-File -FilePath "finalize_output_no_internal.json" -Encoding utf8
