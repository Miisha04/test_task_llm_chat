from fastapi import APIRouter, Body

from services.auth import generate_api_key as make_api_key, verify_api_key

router = APIRouter(prefix="/auth")



@router.get("/generate_api_key")
async def generate_api_key():
    return {
        "api_key": make_api_key()
    }


@router.post("/check_api_key")
async def login(
    api_key: str = Body(
        embed=True,
        min_length=8,
        max_length=255,
        pattern=r"^[A-Za-z0-9_-]+$",
    ),
):
    return {
        "is_verified": verify_api_key(api_key)
    }
