"""单次调用示例：uv run python src/tools/get_weeather.py"""

from lumine import build_agent


def main() -> None:
    agent = build_agent()
    response = agent.invoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": "What is the weather in New York?",
                }
            ]
        }
    )
    print(response["messages"][-1].content)


if __name__ == "__main__":
    main()
