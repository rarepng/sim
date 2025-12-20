cmake_minimum_required(VERSION 4.0)
project(sim LANGUAGES CXX)


set(CMAKE_C_STANDARD 23)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(CMAKE_CXX_SCAN_FOR_MODULES OFF)

set(EMSCRIPTEN_FORCE_REBUILD_SYSROOT ON CACHE BOOL "" FORCE)

set(ENV{EM_CACHE} "${CMAKE_BINARY_DIR}/emcache")


file(GLOB PROJECT_SOURCES "src/main.cpp" "src/*/*.cpp")

add_executable(sim ${PROJECT_SOURCES})

set(ENV{PATH}
    "$ENV{PATH};${CMAKE_SOURCE_DIR}/node_modules/.bin"
)

if(EMSCRIPTEN)
    target_link_options(sim PRIVATE
        $<$<CONFIG:Debug>:
        -O0
        -sASSERTIONS=2
        # -sDEMANGLE_SUPPORT=1
        -g3
        -sSAFE_HEAP=1
        >
    )

    target_link_options(sim PRIVATE
    $<$<CONFIG:Release>:
        -flto
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
        # --emit-tsd sim.auto.d.ts
    )
    target_compile_options(sim PRIVATE -O3)
else()
    message(WARNING "EMSCRIPTEN not defined")
endif()

add_compile_options(--cache-file-hashing)

