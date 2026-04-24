export const baseColors = {
    "u": "rgb(164,158,165)",
    "r": "rgb(255,0,0)",
    "g": "rgb(0,255,0)",
    "b": "rgb(67,110,223)",
    "c": "rgb(0,255,255)",
    "m": "rgb(255,0,255)",
    "y": "rgb(255,255,0)",
    "w": "rgb(255,255,255)",
    "k": "rgb(86,77,78)",
    "p": "rgb(167,41,207)",
    "o": "rgb(213,133,13)",
};

export const colorValues = {
    "rgb": {
        "u": baseColors["u"],
        "r": baseColors["r"],
        "g": baseColors["g"],
        "b": baseColors["b"],
        "c": baseColors["c"],
        "m": baseColors["m"],
        "y": baseColors["y"],
        "w": baseColors["w"]
    },
    "ryb": {
        "u": baseColors["u"],
        "r": baseColors["r"],
        "g": baseColors["y"],
        "b": baseColors["b"],
        "c": baseColors["g"],
        "m": baseColors["p"],
        "y": baseColors["o"],
        "w": baseColors["k"]
    },
    "cmyk": {
        "u": baseColors["u"],
        "r": baseColors["c"],
        "g": baseColors["m"],
        "b": baseColors["y"],
        "c": baseColors["r"],
        "m": baseColors["g"],
        "y": baseColors["b"],
        "w": baseColors["k"]
    }
};
