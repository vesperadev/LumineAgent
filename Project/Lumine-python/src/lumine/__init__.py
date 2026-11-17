from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

from .tools import getWeather


def build_agent():
    """构建基于 DeepSeek 的 Lumine Agent。"""
    load_dotenv()
    model = init_chat_model("deepseek-chat")
    return create_agent(model, tools=[getWeather])


def main() -> None:
    agent = build_agent()
    print("Lumine Agent 已启动（DeepSeek），输入 exit / quit 退出。")
    while True:
        try:
            user_input = input("你: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit"}:
            break
        response = agent.invoke(
            {"messages": [{"role": "user", "content": user_input}]}
        )
        print("Lumine:", response["messages"][-1].content)


if __name__ == "__main__":
    main()
