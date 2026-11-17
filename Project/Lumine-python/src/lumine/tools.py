from langchain.tools import tool


@tool
def getWeather(city: str) -> str:
    """Get the weather for a city.

    Args:
        city: The name of the city to get the weather for.

    Returns:
        A string describing the weather in the city.
    """
    return f"The weather in {city} is nice."
