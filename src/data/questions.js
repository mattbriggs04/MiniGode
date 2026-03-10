const questionBank = {
  easy: [
    {
      id: "contains-duplicate",
      difficulty: "easy",
      title: "Contains Duplicate",
      functionName: "contains_duplicate",
      prompt:
        "Return True when any value appears at least twice in the input list. Otherwise return False.",
      starterCode: `def contains_duplicate(nums):\n    # nums is a list of integers\n    # return a boolean\n    pass\n`,
      examples: [
        "contains_duplicate([1, 2, 3, 1]) -> True",
        "contains_duplicate([1, 2, 3, 4]) -> False"
      ],
      tests: [
        { args: [[1, 2, 3, 1]], expected: true, description: "repeated value", visibility: "shown" },
        { args: [[1, 2, 3, 4]], expected: false, description: "all unique", visibility: "shown" },
        { args: [[5, 5, 5, 5]], expected: true, description: "all repeated", visibility: "hidden" }
      ]
    },
    {
      id: "best-time-to-buy-and-sell-stock",
      difficulty: "easy",
      title: "Best Time to Buy and Sell Stock",
      functionName: "max_profit",
      prompt:
        "Given daily stock prices, return the maximum profit from one buy and one sell. If no profit is possible, return 0.",
      starterCode: `def max_profit(prices):\n    # prices is a list of integers\n    # return the best profit from one transaction\n    pass\n`,
      examples: ["max_profit([7, 1, 5, 3, 6, 4]) -> 5", "max_profit([7, 6, 4, 3, 1]) -> 0"],
      tests: [
        { args: [[7, 1, 5, 3, 6, 4]], expected: 5, description: "profit in middle of list", visibility: "shown" },
        { args: [[7, 6, 4, 3, 1]], expected: 0, description: "strictly decreasing prices", visibility: "shown" },
        { args: [[2, 4, 1]], expected: 2, description: "short list", visibility: "hidden" }
      ]
    },
    {
      id: "climbing-stairs",
      difficulty: "easy",
      title: "Climbing Stairs",
      functionName: "climb_stairs",
      prompt:
        "You can climb either 1 or 2 steps at a time. Return the number of distinct ways to reach the top step.",
      starterCode: `def climb_stairs(n):\n    # n is a positive integer\n    # return the number of distinct ways to reach step n\n    pass\n`,
      examples: ["climb_stairs(2) -> 2", "climb_stairs(5) -> 8"],
      tests: [
        { args: [2], expected: 2, description: "small input", visibility: "shown" },
        { args: [3], expected: 3, description: "three steps", visibility: "shown" },
        { args: [5], expected: 8, description: "larger fibonacci case", visibility: "hidden" }
      ]
    }
  ],
  medium: [
    {
      id: "product-of-array-except-self",
      difficulty: "medium",
      title: "Product of Array Except Self",
      functionName: "product_except_self",
      prompt:
        "Return a list where each position contains the product of every other number except itself. Do not use division.",
      starterCode: `def product_except_self(nums):\n    # nums is a list of integers\n    # return a list of products\n    pass\n`,
      examples: ["product_except_self([1, 2, 3, 4]) -> [24, 12, 8, 6]"],
      tests: [
        { args: [[1, 2, 3, 4]], expected: [24, 12, 8, 6], description: "basic case", visibility: "shown" },
        { args: [[-1, 1, 0, -3, 3]], expected: [0, 0, 9, 0, 0], description: "contains zero", visibility: "shown" },
        { args: [[2, 3]], expected: [3, 2], description: "two values", visibility: "hidden" }
      ]
    },
    {
      id: "longest-substring-without-repeating-characters",
      difficulty: "medium",
      title: "Longest Substring Without Repeating Characters",
      functionName: "length_of_longest_substring",
      prompt:
        "Return the length of the longest substring that contains no repeated characters.",
      starterCode: `def length_of_longest_substring(s):\n    # s is a string\n    # return the maximum unique-substring length\n    pass\n`,
      examples: [
        "length_of_longest_substring('abcabcbb') -> 3",
        "length_of_longest_substring('bbbbb') -> 1"
      ],
      tests: [
        { args: ["abcabcbb"], expected: 3, description: "repeating prefix", visibility: "shown" },
        { args: ["bbbbb"], expected: 1, description: "all same character", visibility: "shown" },
        { args: ["pwwkew"], expected: 3, description: "sliding window reset", visibility: "hidden" }
      ]
    },
    {
      id: "daily-temperatures",
      difficulty: "medium",
      title: "Daily Temperatures",
      functionName: "daily_temperatures",
      prompt:
        "For each day, return how many days you would need to wait until a warmer temperature. If none exists, return 0 for that day.",
      starterCode: `def daily_temperatures(temperatures):\n    # temperatures is a list of integers\n    # return a list of waits\n    pass\n`,
      examples: [
        "daily_temperatures([73, 74, 75, 71, 69, 72, 76, 73]) -> [1, 1, 4, 2, 1, 1, 0, 0]"
      ],
      tests: [
        {
          args: [[73, 74, 75, 71, 69, 72, 76, 73]],
          expected: [1, 1, 4, 2, 1, 1, 0, 0],
          description: "mixed temperatures",
          visibility: "shown"
        },
        { args: [[30, 40, 50, 60]], expected: [1, 1, 1, 0], description: "strictly increasing", visibility: "shown" },
        { args: [[30, 60, 90]], expected: [1, 1, 0], description: "short case", visibility: "hidden" }
      ]
    }
  ],
  hard: [
    {
      id: "trapping-rain-water",
      difficulty: "hard",
      title: "Trapping Rain Water",
      functionName: "trap_rain_water",
      prompt:
        "Given bar heights, return how much rainwater is trapped after raining.",
      starterCode: `def trap_rain_water(height):\n    # height is a list of non-negative integers\n    # return the total trapped water\n    pass\n`,
      examples: ["trap_rain_water([0,1,0,2,1,0,1,3,2,1,2,1]) -> 6"],
      tests: [
        {
          args: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]],
          expected: 6,
          description: "classic sample",
          visibility: "shown"
        },
        { args: [[4, 2, 0, 3, 2, 5]], expected: 9, description: "multiple basins", visibility: "shown" },
        { args: [[1, 0, 2]], expected: 1, description: "single basin", visibility: "hidden" }
      ]
    },
    {
      id: "minimum-window-substring",
      difficulty: "hard",
      title: "Minimum Window Substring",
      functionName: "min_window",
      prompt:
        "Return the smallest substring of s that contains every character in t. If no such substring exists, return an empty string.",
      starterCode: `def min_window(s, t):\n    # s and t are strings\n    # return the minimum window substring\n    pass\n`,
      examples: ["min_window('ADOBECODEBANC', 'ABC') -> 'BANC'"],
      tests: [
        { args: ["ADOBECODEBANC", "ABC"], expected: "BANC", description: "classic sample", visibility: "shown" },
        { args: ["a", "a"], expected: "a", description: "single matching character", visibility: "shown" },
        { args: ["a", "aa"], expected: "", description: "no valid window", visibility: "hidden" }
      ]
    }
  ]
};

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const QUESTION_BANK = questionBank;

const questionIndex = new Map(
  Object.values(questionBank)
    .flat()
    .map((question) => [question.id, question])
);

export function getQuestionPool(difficulty) {
  return questionBank[difficulty] ?? questionBank.easy;
}

export function getQuestionById(questionId) {
  return questionIndex.get(questionId);
}
