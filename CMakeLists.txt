cmake_minimum_required(VERSION 4.0)
project(sim LANGUAGES CXX)


set(CMAKE_C_STANDARD 23)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(CMAKE_CXX_SCAN_FOR_MODULES OFF)


file(GLOB PROJECT_SOURCES "src/main.cpp" "src/*/*.cpp")

add_executable(sim ${PROJECT_SOURCES})



if(EMSCRIPTEN)
    target_link_options(sim PRIVATE
        $<$<CONFIG:Debug>:
        -O0
        -sASSERTIONS=2
        # -sDEMANGLE_SUPPORT=1
        -g3                   # Generate debug info
        -sSAFE_HEAP=1         # Catch memory access errors
        >
    )

    target_link_options(sim PRIVATE
    $<$<CONFIG:Release>:
        -flto                 # Link Time Optimization
        -O3>
    )

    set_target_properties(sim PROPERTIES SUFFIX ".js")
    target_link_options(sim PRIVATE
        -lembind
        -sMODULARIZE=1
        -sALLOW_MEMORY_GROWTH=1
        -sEXPORT_ES6=1
        "-sEXPORTED_RUNTIME_METHODS=[\"HEAPF32\",\"HEAP32\"]"
        -sEXPORT_NAME="createSimModule"
    )
    target_compile_options(sim PRIVATE -O3)
else()
    message(WARNING "EMSCRIPTEN not defined")
endif()

